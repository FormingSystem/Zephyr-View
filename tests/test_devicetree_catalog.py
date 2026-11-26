import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path


helper = Path(__file__).resolve().parents[1] / "extension/devicetree_catalog.py"
spec = importlib.util.spec_from_file_location("devicetree_catalog", helper)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class DevicetreeCatalogTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get("ZEPHYR_BASE"):
            package = Path(os.environ["ZEPHYR_BASE"]) / "scripts/dts/python-devicetree/src"
            sys.path.insert(0, str(package))
            cls.addClassCleanup(sys.path.remove, str(package))
        try:
            from devicetree import dtlib
        except ImportError:
            raise unittest.SkipTest("Provide the Zephyr devicetree package or ZEPHYR_BASE")
        cls.dtlib = dtlib

    def test_real_parser_keeps_hierarchy_aliases_labels_and_typed_properties(self):
        dts = '''/dts-v1/;
/ {
    compatible = "vendor,product", "vendor,family";
    aliases { sensor0 = &probe; };
    bus {
        probe: sense: sensor {
            compatible = "vendor,sensor";
            status = "disabled";
            description = "mode=a;b";
            offsets = <1 2>;
            current-speed = <115200>;
            explicit-zero = <0>;
            empty-text = "";
            wakeup-source;
        };
    };
};'''
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "zephyr.dts"
            source.write_text(dts, encoding="utf-8")
            nodes = {node["path"]: node for node in catalog.export_nodes(self.dtlib.DT(str(source)))}
        root = nodes["/"]
        self.assertIsNone(root["parent"])
        self.assertEqual(root["status"], "okay")
        self.assertTrue(root["statusImplicit"])
        self.assertEqual(root["compatible"], ["vendor,product", "vendor,family"])
        sensor = nodes["/bus/sensor"]
        self.assertEqual(nodes["/bus"]["children"], [sensor["path"]])
        self.assertEqual(sensor["parent"], "/bus")
        self.assertEqual(sensor["status"], "disabled")
        self.assertFalse(sensor["statusImplicit"])
        self.assertCountEqual(sensor["labels"], ["probe", "sense"])
        self.assertEqual(sensor["aliases"], ["sensor0"])
        props = {prop["name"]: prop for prop in sensor["properties"]}
        self.assertEqual(props["description"]["value"], '"mode=a;b"')
        self.assertEqual(props["description"]["scalar"], "mode=a;b")
        self.assertEqual(props["current-speed"]["scalar"], 115200)
        self.assertEqual(props["explicit-zero"]["scalar"], 0)
        self.assertEqual(props["empty-text"]["scalar"], "")
        self.assertEqual(props["offsets"]["type"], "nums")
        self.assertNotIn("scalar", props["offsets"])
        self.assertEqual(props["wakeup-source"]["value"], "")

    def test_special_nodes_keep_name_mappings_separate_from_hardware_metadata(self):
        dts = '''/dts-v1/;
/ {
    aliases { status = &uart; compatible = &uart; };
    chosen { zephyr,console = &uart; };
    soc { uart: serial@4000 { compatible = "vendor,uart"; }; };
};'''
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "zephyr.dts"
            source.write_text(dts, encoding="utf-8")
            nodes = {node["path"]: node for node in catalog.export_nodes(self.dtlib.DT(str(source)))}

        for path, names in (("/aliases", ["status", "compatible"]), ("/chosen", ["zephyr,console"])):
            node = nodes[path]
            self.assertIsNone(node["status"])
            self.assertFalse(node["statusImplicit"])
            self.assertEqual(node["compatible"], [])
            self.assertEqual({p["name"]: p["value"] for p in node["properties"]}, dict.fromkeys(names, "&uart"))

        uart = nodes["/soc/serial@4000"]
        self.assertEqual(uart["parent"], "/soc")
        self.assertEqual(nodes["/soc"]["children"], [uart["path"]])
        self.assertCountEqual(uart["aliases"], ["status", "compatible"])
        self.assertEqual(uart["compatible"], ["vendor,uart"])
