"""Read capability declarations from the selected Zephyr checkout without running a probe."""
import argparse
import json
import sys
from pathlib import Path


def flash_capabilities(base):
    sys.path.insert(0, str(Path(base) / "scripts" / "west_commands"))
    from runners import ZephyrBinaryRunner

    result = {}
    tools = {"pyocd": "--pyocd", "jlink": "--commander",
             "stm32cubeprogrammer": "--cli", "dfu-util": "--dfu-util"}
    for cls in ZephyrBinaryRunner.get_runners():
        caps = cls.capabilities()
        name = cls.name()
        entry = {"flash": "flash" in caps.commands, "device": bool(getattr(caps, "dev_id", False))}
        if name in tools:
            parser = argparse.ArgumentParser()
            cls.add_parser(parser)
            if tools[name] in parser.format_help():
                entry["toolOption"] = tools[name]
        result[name] = entry
    return result


if __name__ == "__main__":
    print(json.dumps(flash_capabilities(sys.argv[1]), sort_keys=True))
