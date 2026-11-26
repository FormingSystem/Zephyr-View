import importlib.util
from pathlib import Path
import shlex
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


path = Path(__file__).resolve().parents[1] / "extension/kconfig_catalog.py"
spec = importlib.util.spec_from_file_location("kconfig_catalog", path)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class MenuEnvironmentTest(unittest.TestCase):
    command = ('cmake -E env "srctree=/zephyr tree" KCONFIG_CONFIG=/work/zephyr/.config '
               '"PYTHON_EXECUTABLE=/python env/python" "/python env/python" '
               '"/zephyr tree/scripts/kconfig/menuconfig.py" "/app sources/Kconfig"')

    def check_context(self, build):
        with patch.object(catalog, "command_words", shlex.split):
            env, menu, root, python = catalog.menu_environment(build)
        self.assertEqual(env["srctree"], "/zephyr tree")
        self.assertEqual(menu, "/zephyr tree/scripts/kconfig/menuconfig.py")
        self.assertEqual(root, "/app sources/Kconfig")
        self.assertEqual(python, "/python env/python")

    def test_posix_ninja_command_uses_the_configured_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp)
            rule = "build CMakeFiles/menuconfig | current: CUSTOM_COMMAND\n"
            (build / "build.ninja").write_text(rule + "  COMMAND = cd /work/zephyr/kconfig && " + self.command)
            self.check_context(build)

    def test_make_command_preserves_paths_with_spaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp)
            make = build / "zephyr/CMakeFiles/menuconfig.dir/build.make"
            make.parent.mkdir(parents=True)
            make.write_text("\tcd /work/zephyr/kconfig && " + self.command)
            self.check_context(build)

    def test_missing_target_does_not_run_a_stale_windows_batch_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp)
            (build / "CMakeFiles").mkdir()
            (build / "CMakeFiles/menuconfig-abc123.bat").write_text(self.command)
            (build / "build.ninja").write_text("build menuconfig: phony disabled")
            with self.assertRaisesRegex(ValueError, "menuconfig"):
                catalog.menu_environment(build)


class SymbolMenuTest(unittest.TestCase):
    def test_multiple_definitions_keep_distinct_visible_paths_and_literal_separators(self):
        root = SimpleNamespace(parent=None, prompt=("Top", 1))
        def node(label, parent, visible=1):
            return SimpleNamespace(prompt=(label, visible), parent=parent, help=None)

        first = node("UART", node("Board › hardware", root))
        hidden = node("UART", node("Hidden", root), visible=0)
        second = node("UART", node("Serial", node("Drivers", root)))
        lib = SimpleNamespace(expr_value=lambda value: value, TYPE_TO_STR={1: "bool"},
                              BOOL=1, TRISTATE=2, TRI_TO_STR={0: "n", 2: "y"})
        symbol = SimpleNamespace(name="UART", nodes=[first, hidden, first, second], visibility=2,
                                 type=1, str_value="y", assignable=[0, 2], choice=None, ranges=[])
        item = catalog.symbol_data(lib, symbol, "CONFIG_")
        self.assertEqual(item["menuPath"], ["Board › hardware"])
        self.assertEqual(item["menuPaths"], [["Board › hardware"], ["Drivers", "Serial"]])
