"""Read the selected Zephyr checkout's hardware model, including module board roots."""

import argparse
import json
import sys
from pathlib import Path


def catalog(options):
    base = Path(options["base"])
    sys.path.insert(0, str(base / "scripts"))
    import list_boards

    roots = {kind: list(map(Path, paths)) for kind, paths in options["roots"].items()}
    if options["manifest"] or options["modules"] or options["extraModules"]:
        from zephyr_module import parse_modules

        modules = parse_modules(str(base), modules=options["modules"] or None,
                                extra_modules=options["extraModules"] or [])
        for module in modules:
            settings = module.meta.get("build", {}).get("settings", {})
            for kind in roots:
                if kind in settings:
                    roots[kind].append(Path(module.project) / settings[kind])
    for directories in roots.values():
        directories.append(base)

    args = argparse.Namespace(board=options.get("name"), board_dir=list(map(Path, options["boardDirectories"])),
                              board_roots=roots["board_root"], soc_roots=roots["soc_root"],
                              arch_roots=roots["arch_root"])
    if not hasattr(list_boards, "find_v2_boards"):
        # The first hardware model exposes unqualified board targets.
        return [{"name": board.name, "directories": [str(board.dir)], "socs": [],
                 "revisions": [], "qualifiers": []} for board in list_boards.find_boards(args)
                if not args.board or board.name == args.board]
    return [{"name": board.name, "directories": list(map(str, board.directories)),
             "socs": [soc.name for soc in board.socs], "revisions": [rev.name for rev in board.revisions],
             "cpuClusters": [f"{soc.name}/{cluster.name}" for soc in board.socs
                             for cluster in getattr(soc, "cpuclusters", [])],
             "defaultRevision": getattr(board, "revision_default", None),
             "qualifiers": list_boards.board_v2_qualifiers(board)}
            for board in list_boards.find_v2_boards(args).values()]


if __name__ == "__main__":
    print(json.dumps(catalog(json.loads(sys.argv[1]))))
