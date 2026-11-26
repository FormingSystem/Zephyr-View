"""Reference data from this checkout's Zephyr hardware and Twister APIs."""

import json
import os
import re
import subprocess
import sys
import tempfile
from argparse import Namespace
from pathlib import Path

base = Path(os.environ["ZEPHYR_BASE"]).resolve()
sys.path[:0] = [str(base / "scripts"), str(base / "scripts/pylib/twister")]
from twisterlib.platform import generate_platforms
from zephyr_module import parse_modules
from list_boards import board_v2_qualifiers, find_v2_boards


def cmake_argument(value):
    """Use bracket arguments so spaces, dollar signs and quotes in paths stay literal."""
    marker = "="
    while f"]{marker}]" in value:
        marker += "="
    return f"[{marker}[{value}]{marker}]"


def reference_dts(boards):
    """Exercise just Zephyr's DTS input resolver without preprocessing or building firmware."""
    source = (base / "cmake/modules/dts.cmake").read_text(encoding="utf-8")
    resolver = re.search(r"^function\(dts_configuration_files\).*?^endfunction\([^)]*\)",
                         source, re.MULTILINE | re.DOTALL)
    if not resolver:
        raise RuntimeError("This checkout does not expose dts_configuration_files()")
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        script = root / "reference.cmake"
        with script.open("w", encoding="utf-8") as output:
            output.write('cmake_minimum_required(VERSION 3.20)\n'
                         'list(APPEND CMAKE_MODULE_PATH "${ZEPHYR_BASE}/cmake/modules")\n'
                         'include(extensions)\n')
            output.write(resolver.group() + "\n")
            output.write('function(resolve target BOARD BOARD_QUALIFIERS single revision)\n'
                         '  set(BOARD_DIRECTORIES "${ARGN}")\n'
                         '  set(BOARD_${BOARD}_SINGLE_SOC "${single}")\n'
                         '  string(REPLACE "." "_" BOARD_REVISION_STRING "${revision}")\n'
                         '  dts_configuration_files()\n'
                         '  list(GET dts_files 0 first)\n'
                         '  file(APPEND "${RESULT}" "${target}\\t${first}\\n")\n'
                         'endfunction()\n')
            for board in boards:
                directories = [directory.as_posix() for directory in board.directories]
                revisions = [("", board.revision_default or "")]
                revisions.extend((f"@{r.name}", r.name) for r in board.revisions if r.name)
                for qualifier in board_v2_qualifiers(board):
                    for suffix, revision in revisions:
                        target = f"{board.name}{suffix}/{qualifier}"
                        args = [target, board.name, qualifier, str(len(board.socs) == 1),
                                revision, *directories]
                        output.write("resolve(" + " ".join(map(cmake_argument, args)) + ")\n")
        result = root / "resolved.tsv"
        subprocess.run(["cmake", "--log-level=ERROR", f"-DZEPHYR_BASE={base.as_posix()}",
                        f"-DUSER_CACHE_DIR={root.as_posix()}", f"-DRESULT={result.as_posix()}",
                        f"-DPython3_EXECUTABLE={sys.executable}", "-P", str(script)],
                       cwd=root, check=True)
        return dict(line.split("\t", 1) for line in result.read_text(encoding="utf-8").splitlines())

roots = {kind: [base] for kind in ("board_root", "soc_root", "arch_root")}
if "--workspace" in sys.argv:
    for module in parse_modules(str(base)):
        settings = module.meta.get("build", {}).get("settings", {})
        for kind in roots:
            if kind in settings:
                roots[kind].append(Path(module.project) / settings[kind])

platforms = generate_platforms(roots["board_root"], roots["soc_root"], roots["arch_root"])
arches = {name: p.arch for p in platforms for name in [p.name, *p.aliases]}
args = Namespace(board_roots=roots["board_root"], soc_roots=roots["soc_root"],
                 arch_roots=roots["arch_root"], board=None, board_dir=None)
devicetrees = reference_dts(find_v2_boards(args).values())
samples = []
for directory, children, files in os.walk(base / "samples"):
    if "CMakeCache.txt" in files:
        children.clear()
        continue
    if {"sample.yaml", "testcase.yaml", "tests.yaml"}.intersection(files):
        samples.append({"path": Path(directory).relative_to(base).as_posix(),
                        "cmake": "CMakeLists.txt" in files, "defaultConf": "prj.conf" in files,
                        "confFiles": sum(name.endswith(".conf") for name in files),
                        "overlays": sum(name.endswith(".overlay") for name in files)})
print(json.dumps({"arches": arches, "samples": samples, "dts": devicetrees}))
