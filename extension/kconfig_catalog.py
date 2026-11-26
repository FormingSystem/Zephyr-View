"""Inspect the configured Zephyr menu with the build's own Python and kconfiglib."""

import ctypes
from contextlib import redirect_stdout
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path


def command_words(command):
    if os.name != "nt":
        return shlex.split(command)
    split = ctypes.windll.shell32.CommandLineToArgvW
    split.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
    split.restype = ctypes.POINTER(ctypes.c_wchar_p)
    count = ctypes.c_int()
    ptr = split(command, ctypes.byref(count))
    if not ptr:
        raise ValueError("Invalid Windows menuconfig command")
    try:
        return [ptr[i] for i in range(count.value)]
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(ptr, ctypes.c_void_p))


def menu_commands(build):
    for directory in (build, build / "zephyr"):
        make = directory / "CMakeFiles/menuconfig.dir/build.make"
        if make.is_file():
            yield from make.read_text(encoding="utf-8").replace("\\\n", "").replace("$$", "$").splitlines()
    ninja = build / "build.ninja"
    if not ninja.is_file():
        return
    # Follow the current target's rule, avoiding obsolete CMake-generated batch files.
    in_target = False
    for line in ninja.read_text(encoding="utf-8").replace("$\n", "").splitlines():
        if line.startswith("build "):
            in_target = bool(re.match(r"build (?:zephyr/)?CMakeFiles/menuconfig(?:\s|:)", line))
        elif in_target and line.lstrip().startswith("COMMAND = "):
            command = line.strip()[len("COMMAND = "):].replace("$$", "$")
            batch = re.search(r"((?:zephyr[/\\])?CMakeFiles[/\\]menuconfig-[\da-f]+\.bat)\b", command, re.I)
            if batch:
                yield from (build / batch[1]).read_text(encoding="utf-8").replace("%%", "%").splitlines()
            else:
                yield command


def menu_environment(build):
    for command in menu_commands(build):
        marker = re.search(r"\s-E\s+env\s+", command)
        if not marker or "menuconfig.py" not in command:
            continue
        words = command_words(command[marker.end():])
        index = next((i for i, word in enumerate(words) if Path(word).name == "menuconfig.py"), None)
        if index is None or index + 1 >= len(words):
            continue
        env = dict(os.environ)
        for word in words[:index-1]:
            name, equal, value = word.partition("=")
            if equal and re.fullmatch(r"\w+", name):
                env[name] = value
        if not env.get("srctree") or not env.get("KCONFIG_CONFIG"):
            continue
        return env, words[index], words[index+1], env.get("PYTHON_EXECUTABLE", words[index-1])
    raise ValueError("No usable menuconfig command for this build directory")


def menu_path(node):
    parents = []
    parent = node.parent
    while parent and parent.parent:
        if parent.prompt:
            parents.append(parent.prompt[0])
        parent = parent.parent
    return list(reversed(parents))


def symbol_data(lib, sym, prefix):
    prompts = [node for node in sym.nodes if node.prompt and lib.expr_value(node.prompt[1])]
    if not prompts or not sym.visibility:
        return None
    node = prompts[0]
    item = {"name": prefix + sym.name, "prompt": node.prompt[0], "type": lib.TYPE_TO_STR[sym.type],
            "value": sym.str_value}
    paths = []
    for definition in prompts:
        menu = menu_path(definition)
        if menu not in paths:
            paths.append(menu)
    item["menuPath"], item["menuPaths"] = paths[0], paths
    if paths[0]:
        item["menu"] = " › ".join(paths[0])
    if sym.type in (lib.BOOL, lib.TRISTATE):
        item["allowed"] = [lib.TRI_TO_STR[value] for value in sym.assignable]
    if sym.choice and sym.choice.tri_value == 2:
        item["choice"] = [prefix + member.name for member in sym.choice.syms if member.visibility]
    for low, high, condition, *_ in sym.ranges:
        if lib.expr_value(condition):
            item["range"] = [low.str_value, high.str_value]
            break
    if node.help:
        item["help"] = node.help.strip()
    return item


def export_symbols(menu, root):
    sys.path.insert(0, str(Path(menu).parent))
    import kconfiglib as lib
    with redirect_stdout(sys.stderr):
        cfg = lib.Kconfig(root, warn=False)
        cfg.load_config(os.environ["KCONFIG_CONFIG"])
        items = [symbol_data(lib, sym, cfg.config_prefix) for sym in cfg.unique_defined_syms]
    json.dump([item for item in items if item], sys.stdout, ensure_ascii=True)


def main():
    if sys.argv[1] == "--symbols":
        export_symbols(*sys.argv[2:])
        return
    env, menu, root, python = menu_environment(Path(sys.argv[1]).resolve())
    cwd = Path(env["KCONFIG_CONFIG"]).parent / "kconfig"
    subprocess.run([python, __file__, "--symbols", menu, root], cwd=cwd, env=env, check=True)


if __name__ == "__main__":
    main()
