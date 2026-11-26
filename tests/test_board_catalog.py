"""Exercise the Zephyr 3.7 and newer hardware-reader interfaces without a checkout."""

import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "extension"))
from board_catalog import BoardFiles, catalog, read_modules


class BoardCatalogTests(unittest.TestCase):
    def catalogue(self, newer):
        root = Path("source").resolve()
        good = root / "boards" / "kit" / "board.yml"
        broken = root / "boards" / "broken" / "board.yml"
        bad_soc = root / "soc" / "broken" / "soc.yml"
        v1 = Namespace(name="legacy", dir=root / "boards" / "legacy")
        v2 = Namespace(name="kit", socs=[Namespace(name="chip")], revisions=[Namespace(name="1")])

        class Systems:
            @staticmethod
            def from_file(filename):
                raise SystemExit("SoC schema validation failed")

        def load(_name, file, _systems):
            if file == broken:
                raise RuntimeError("board schema validation failed")
            if newer:
                v2.directories = [good.parent]
                return {"kit": v2}, []
            v2.dir = good.parent
            return [v2]

        def find(args):
            socs = Systems.from_file(bad_soc)
            results = [reader.load_v2_boards(args.board, file, socs) for file in [broken, good]]
            if newer:
                return {name: board for boards, _ in results for name, board in boards.items()}
            return [board for boards in results for board in boards]

        reader = SimpleNamespace(find_boards=lambda _: [v1], find_v2_boards=find, load_v2_boards=load,
                                 list_hardware=SimpleNamespace(Systems=Systems), board_v2_qualifiers=lambda _: ["chip"])
        if newer:
            reader.extend_v2_boards = lambda *_: None
        options = {"base": str(root), "roots": {"board_root": [], "arch_root": [], "soc_root": []},
                   "manifest": False, "modules": [], "extraModules": [], "boardDirectories": []}
        with patch.dict(sys.modules, {"list_boards": reader, "yaml": Namespace(YAMLError=ValueError)}):
            result = catalog(options)
        self.assertEqual([board["name"] for board in result["boards"]], ["legacy", "kit"])
        self.assertEqual(result["boards"][1]["qualifiers"], ["chip"])
        self.assertEqual(result["boards"][1]["directories"], [str(good.parent)])
        self.assertEqual(result["boards"][1]["revisions"], ["1"])
        self.assertEqual(result["diagnostics"], [
            {"kind": "socFile", "path": str(bad_soc), "message": "SoC schema validation failed"},
            {"kind": "boardFile", "path": str(broken), "message": "board schema validation failed"},
        ])

    def test_lts_list_and_single_directory(self):
        self.catalogue(newer=False)

    def test_mapping_and_multiple_directories(self):
        self.catalogue(newer=True)

    def test_module_file_failure_preserves_independent_manifest_and_extra_modules(self):
        def process(project):
            if project == "broken":
                raise ValueError("invalid module YAML")
            deps = ["broken"] if project == "dependent" else []
            return {"name": project, "build": {"depends": deps}}

        def parse(base, modules, extra_modules):
            metas = [reader.process_module(p) for p in modules + extra_modules]
            if any(meta and meta["build"]["depends"] for meta in metas):
                raise SystemExit("Unmet or cyclic dependencies in modules:\ndependent depends on broken")
            return [meta["name"] for meta in metas if meta]

        projects = [Namespace(posixpath=p) for p in ["standalone", "broken", "dependent"]]
        reader = Namespace(process_module=process, parse_modules=parse, west_projects=lambda: {"projects": projects})
        options = {"manifest": True, "manifestPath": "west.yml", "modules": [], "extraModules": ["external"]}
        diagnostics = []
        with patch.dict(sys.modules, {"zephyr_module": reader, "yaml": Namespace(YAMLError=ValueError)}):
            self.assertEqual(set(read_modules(Path("."), options, diagnostics)), {"standalone", "external"})
        self.assertEqual([Path(d["path"]).parts[0] for d in diagnostics], ["broken", "dependent"])
        self.assertIn("Unresolved module dependencies: broken", diagnostics[-1]["message"])

    def test_ambiguous_names_and_invalid_extensions_leave_other_boards_unaffected(self):
        paths = [Path(group, "board.yml") for group in ["working", "second", "extension"]]

        def load(_, file, systems):
            if file == paths[0]:
                return {"working": [], "ambiguous": []}, []
            if file == paths[1]:
                return {"ambiguous": []}, []
            return {}, [{"extend": "working", "dir": file.parent}]

        def extend(boards, _):
            boards["working"].append("incomplete edit")
            raise RuntimeError("invalid board variant")

        def find(args):
            boards, extensions = {}, []
            for file in paths:
                batch, additions = reader.load_v2_boards(None, file, None)
                assert not (boards.keys() & batch.keys())
                boards.update(batch)
                extensions.extend(additions)
            reader.extend_v2_boards(boards, extensions)
            return boards

        reader = Namespace(BOARD_YML="board.yml", load_v2_boards=load, extend_v2_boards=extend, find_v2_boards=find)
        diagnostics = []
        with patch.dict(sys.modules, {"yaml": Namespace(YAMLError=ValueError)}):
            self.assertEqual(BoardFiles(reader, diagnostics).read(Namespace()), {"working": []})
        self.assertEqual([Path(d["path"]) for d in diagnostics], paths[1:])

    def test_west_project_lookup_uses_the_selected_topdir_and_reports_a_failed_import(self):
        initial = Path.cwd()
        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder).resolve()
            manifest_path = str(workspace / "manifest" / "west.yml")

            def west_projects():
                self.assertTrue(Path.cwd().samefile(workspace))
                raise SystemExit("Imported manifest was not found")

            def parse(base, modules, extra_modules):
                self.assertTrue(Path.cwd().samefile(initial))
                return modules

            reader = Namespace(west_projects=west_projects, parse_modules=parse, process_module=lambda _: None)
            options = {"manifest": True, "manifestPath": manifest_path, "manifestRoot": folder,
                       "modules": [], "extraModules": []}
            diagnostics = []
            with patch.dict(sys.modules, {"zephyr_module": reader, "yaml": Namespace(YAMLError=ValueError)}):
                self.assertEqual(read_modules(initial, options, diagnostics), [])
            self.assertEqual(diagnostics, [{"kind": "manifestFile", "path": manifest_path,
                                           "message": "Imported manifest was not found"}])
