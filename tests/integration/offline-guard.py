"""Installed as sitecustomize in the test venv. Record and reject network and west launches."""

import os
import shlex
import sys
from pathlib import Path


def deny(event, value):
    with open(os.environ["ZEPHYR_OFFLINE_AUDIT"], "a", encoding="utf-8") as log:
        print(event, repr(value), file=log)
    raise PermissionError(f"Offline test rejected {event}: {value}")


def audit(event, args):
    if event in {"socket.getaddrinfo", "socket.gethostbyname", "socket.connect", "socket.sendto"}:
        deny(event, args[-1])
    if event == "subprocess.Popen":
        executable, arguments = args[:2]
        if isinstance(arguments, str):
            arguments = shlex.split(arguments, posix=False)
        command = executable or arguments[0]
        if Path(os.fsdecode(command).strip('"')).stem.lower() == "west":
            deny("west executable", command)
        if "-m" in arguments:
            module = arguments[arguments.index("-m") + 1:][:1]
            if module and module[0].split(".")[0] == "west":
                deny("west Python module", module)


sys.addaudithook(audit)
