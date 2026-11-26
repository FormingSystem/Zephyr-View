"""Read a configured zephyr.dts using dtlib from the same Zephyr checkout."""

import json
import sys
from collections import defaultdict
from pathlib import Path


def property_data(prop):
    # dtlib renders phandles, strings, cells and /bits/ using valid DTS syntax.
    declaration = str(prop)
    _, separator, value = declaration.partition(" =")
    kind = prop.type.name.lower()
    result = {"name": prop.name, "type": kind, "value": value.strip()[:-1] if separator else ""}
    if prop.labels or prop.offset_labels or prop.name in ("phandle", "linux,phandle"):
        return result
    if kind == "num":
        result["scalar"] = prop.to_num()
    elif kind == "string":
        try:
            result["scalar"] = prop.value[:-1].decode("utf-8")
        except UnicodeDecodeError:
            pass  # The DTS spelling still exposes strings containing arbitrary bytes.
    return result


def export_nodes(tree):
    aliases = defaultdict(list)
    for alias, node in tree.alias2node.items():
        aliases[node.path].append(alias)
    nodes = []
    for node in tree.node_iter():
        status = node.props.get("status")
        compatible = node.props.get("compatible")
        nodes.append({
            "path": node.path, "parent": node.parent.path if node.parent else None,
            "name": node.name or "/", "labels": node.labels, "aliases": aliases[node.path],
            "compatible": compatible.to_strings() if compatible else [],
            "status": status.to_string() if status is not None else "okay", "statusImplicit": status is None,
            "children": [child.path for child in node.nodes.values()],
            "properties": [property_data(prop) for prop in node.props.values()],
        })
    return nodes


def main(package, merged_file):
    sys.path.insert(0, str(package))
    if (package / "devicetree/dtlib.py").is_file():
        from devicetree import dtlib
    elif (package / "dtlib.py").is_file():
        import dtlib
    else:
        raise FileNotFoundError("The selected Zephyr checkout has no dtlib module")
    tree = dtlib.DT(str(merged_file))
    json.dump(export_nodes(tree), sys.stdout, ensure_ascii=True, separators=(",", ":"))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
