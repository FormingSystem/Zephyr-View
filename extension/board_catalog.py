"""Read the selected Zephyr checkout's hardware model, including module board roots."""

import argparse
import json
import os
import sys
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch


def module_file(project):
    file = Path(project) / "zephyr" / "module.yml"
    return file.with_suffix(".yaml") if not file.is_file() and file.with_suffix(".yaml").is_file() else file


def independent_modules(records, diagnostics):
    """Drop missing or cyclic dependencies before retrying Zephyr's own topological sort."""
    ready = set()
    while True:
        available = {name for name, (_, deps) in records.items() if deps <= ready} - ready
        if not available:
            break
        ready.update(available)
    for name, (project, deps) in records.items():
        if name not in ready:
            diagnostics.append({"kind": "moduleFile", "path": str(module_file(project)),
                                "message": "Unresolved module dependencies: " + ", ".join(sorted(deps - ready))})
    return [project for name, (project, _) in records.items() if name in ready]


def manifest_projects(reader, root):
    # west resolves the manifest from the current directory. The source checkout
    # can be on another volume when a workspace links it through a junction.
    previous = Path.cwd()
    try:
        if root:
            os.chdir(root)
        workspace = reader.west_projects()
    finally:
        os.chdir(previous)
    return [project.posixpath for project in workspace["projects"]] if workspace else []


def read_modules(base, options, diagnostics):
    import zephyr_module

    selected = options["modules"] or (None if options["manifest"] else [])
    if selected is None and options.get("manifestPath") and hasattr(zephyr_module, "west_projects"):
        selected = []
        with report_file_error("manifestFile", options["manifestPath"], diagnostics):
            selected = manifest_projects(zephyr_module, options.get("manifestRoot"))
    records, extras = {}, []
    load = zephyr_module.process_module

    def load_module(project, *args, **kwargs):
        with report_file_error("moduleFile", module_file(project), diagnostics):
            meta = load(project, *args, **kwargs)
            if meta:
                records[meta["name"]] = (project, set(meta.get("build", {}).get("depends", [])))
            elif project in options["extraModules"]:
                raise ValueError("Expected zephyr/module.yml or both zephyr/CMakeLists.txt and zephyr/Kconfig")
            return meta

    # Invalid extra modules are fatal to parse_modules, unlike regular non-module west projects.
    for project in options["extraModules"]:
        if load_module(project):
            extras.append(project)
    with patch.object(zephyr_module, "process_module", load_module):
        try:
            return zephyr_module.parse_modules(str(base), modules=selected, extra_modules=extras)
        except SystemExit as error:
            if not str(error).startswith("Unmet or cyclic dependencies in modules:"):
                raise
    projects = independent_modules(records, diagnostics)
    return zephyr_module.parse_modules(str(base), modules=projects, extra_modules=[])


def catalog_roots(base, options, diagnostics):
    roots = {kind: list(map(Path, paths)) for kind, paths in options["roots"].items()}
    if options["manifest"] or options["modules"] or options["extraModules"]:
        modules = read_modules(base, options, diagnostics)
        for module in modules:
            settings = module.meta.get("build", {}).get("settings", {})
            for kind in roots:
                if kind in settings:
                    roots[kind].append(Path(module.project) / settings[kind])
    for directories in roots.values():
        directories.append(base)
    return roots


@contextmanager
def report_file_error(kind, filename, diagnostics):
    from yaml import YAMLError

    try:
        yield
        return
    except (OSError, ValueError, LookupError, RuntimeError, SystemExit, YAMLError) as error:
        message = str(error)
    except (AttributeError, TypeError) as error:
        # Older readers may raise a second exception while formatting the schema error.
        cause = error.__context__
        if not isinstance(cause, YAMLError) and type(cause).__module__ != "pykwalify.errors":
            raise
        message = str(cause)
    diagnostics.append({"kind": kind, "path": str(filename), "message": message})


class BoardFiles:
    """Delegate hardware resolution to Zephyr and isolate failures at its file-loading boundaries."""

    def __init__(self, reader, diagnostics):
        self.reader = reader
        self.diagnostics = diagnostics
        self.load = getattr(reader, "load_v2_boards", None)
        self.extend = getattr(reader, "extend_v2_boards", None)
        self.owners = {}
        self.conflicts = set()

    def load_file(self, name, filename, systems):
        with report_file_error("boardFile", filename, self.diagnostics):
            result = self.load(name, filename, systems)
            if self.extend is None:
                return result
            boards, extensions = result
            for target in list(boards):
                if target in self.owners:
                    self.conflicts.add(target)
                    del boards[target]
                    self.diagnostics.append({"kind": "boardFile", "path": str(filename),
                                             "message": f"Board {target} is also defined in {self.owners[target]}"})
                else:
                    self.owners[target] = filename
            return boards, extensions
        # Zephyr 3.7 returns a list. Newer loaders return boards and extensions.
        return ({}, []) if self.extend else []

    def extend_boards(self, boards, extensions):
        for entry in extensions:
            target = entry["extend"]
            if target not in boards or target in self.conflicts:
                continue
            with report_file_error("boardFile", Path(entry["dir"]) / self.reader.BOARD_YML, self.diagnostics):
                # A failed variant can partially mutate its base board in the official loader.
                candidate = {target: deepcopy(boards[target])}
                self.extend(candidate, [entry])
                boards[target] = candidate[target]

    def guard_soc_files(self, scope):
        systems = getattr(getattr(self.reader, "list_hardware", None), "Systems", None)
        if systems and hasattr(systems, "from_file"):
            load_soc = systems.from_file

            def load_soc_file(filename):
                with report_file_error("socFile", filename, self.diagnostics):
                    return load_soc(filename)
                return systems()

            scope.enter_context(patch.object(systems, "from_file", staticmethod(load_soc_file)))

    def read(self, args):
        with ExitStack() as scope:
            if self.load:
                scope.enter_context(patch.object(self.reader, "load_v2_boards", self.load_file))
            if self.extend:
                scope.enter_context(patch.object(self.reader, "extend_v2_boards", self.extend_boards))
            self.guard_soc_files(scope)
            found = self.reader.find_v2_boards(args)
        for target in self.conflicts:
            found.pop(target, None)
        return found


def v2_record(board, reader):
    directories = getattr(board, "directories", None) or [board.dir]
    return {"name": board.name, "directories": list(map(str, directories)),
            "socs": [soc.name for soc in board.socs], "revisions": [rev.name for rev in board.revisions],
            "cpuClusters": [f"{soc.name}/{cluster.name}" for soc in board.socs
                            for cluster in getattr(soc, "cpuclusters", [])],
            "defaultRevision": getattr(board, "revision_default", None),
            "qualifiers": reader.board_v2_qualifiers(board)}


def catalog(options):
    base = Path(options["base"])
    sys.path.insert(0, str(base / "scripts"))
    import list_boards

    boards, diagnostics = [], []
    roots = catalog_roots(base, options, diagnostics)
    args = argparse.Namespace(board=options.get("name"), board_dir=None, board_roots=roots["board_root"],
                              soc_roots=roots["soc_root"], arch_roots=roots["arch_root"])
    directories = list(map(Path, options["boardDirectories"]))
    if hasattr(list_boards, "find_boards"):
        for board in list_boards.find_boards(args):
            if (not args.board or board.name == args.board) and (not directories or board.dir in directories):
                boards.append({"name": board.name, "directories": [str(board.dir)], "socs": [],
                               "revisions": [], "qualifiers": []})
    if hasattr(list_boards, "find_v2_boards"):
        args.board_dir = directories
        found = BoardFiles(list_boards, diagnostics).read(args)
        for board in found.values() if isinstance(found, dict) else found:
            record = v2_record(board, list_boards)
            if not directories or any(Path(directory) in directories for directory in record["directories"]):
                boards.append(record)
    return {"boards": boards, "diagnostics": diagnostics}


if __name__ == "__main__":
    print(json.dumps(catalog(json.loads(sys.argv[1]))))
