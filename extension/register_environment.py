"""Read or update one workbench-managed systemd environment.d entry."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile


def render(name, value):
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "$$")
    return f'# Zephyr Extension\n{name}="{escaped}"\n'


def read_entry(file, name):
    if file.is_symlink():
        raise ValueError("Cannot replace a symbolic link.")
    if not file.exists():
        return None
    text = file.read_text(encoding="utf-8")
    prefix = f'# Zephyr Extension\n{name}="'
    if not text.startswith(prefix) or not text.endswith('"\n'):
        raise ValueError(f"Review the existing file before continuing: {file}")
    value = re.sub(r'\\\\|\\"|\$\$', lambda m: m.group()[1], text[len(prefix):-2])
    if render(name, value) != text or "\n" in value:
        raise ValueError(f"Unexpected content in {file}")
    return value


def register(request, directory):
    name = request["name"]
    if name not in {"ZEPHYR_BASE", "ZEPHYR_SDK_INSTALL_DIR", "ZEPHYR_TOOLCHAIN_VARIANT", "CROSS_COMPILE"}:
        raise ValueError("Invalid environment variable.")
    file = directory / f"80-zephyr-workbench-{name}.conf"
    if not request.get("write"):
        return read_entry(file, name)
    value = request["value"]
    if not isinstance(value, str) or not value or any(c in value for c in "\x00\r\n"):
        raise ValueError("Invalid environment value.")
    import fcntl
    directory.mkdir(parents=True, exist_ok=True)
    lock = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if read_entry(file, name) != request.get("previous"):
            raise ValueError("Environment setting changed. Review the new value.")
        fd, temporary = tempfile.mkstemp(dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(render(name, value))
                os.fchmod(stream.fileno(), 0o644 if request["scope"] == "Machine" else 0o600)
            os.replace(temporary, file)
        finally:
            Path(temporary).unlink(missing_ok=True)
    finally:
        os.close(lock)


if __name__ == "__main__":
    print(json.dumps(register(json.loads(sys.argv[1]), Path(sys.argv[2]))))
