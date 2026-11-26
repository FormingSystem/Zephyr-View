"""Prepare an isolated build interpreter from installed distributions, without fetching wheels."""

import shutil
import subprocess
import sys
import sysconfig
import venv
from importlib.metadata import distribution
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def prepare(destination, extra_packages=()):
    venv.EnvBuilder(with_pip=False).create(destination)
    child = destination / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    site = Path(subprocess.check_output(
        [child, "-I", "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"], text=True
    ).strip())
    source = Path(sysconfig.get_path("purelib")).resolve()
    pending = ["PyYAML", "jsonschema", "pyelftools", "packaging", "intelhex", *extra_packages]
    installed = set()
    while pending:
        name = canonicalize_name(pending.pop())
        if name in installed:
            continue
        if name == "west":
            raise RuntimeError("A requested build dependency requires west")
        package = distribution(name)
        for item in package.files or ():
            file = Path(package.locate_file(item)).resolve()
            if file.is_relative_to(source) and file.is_file() and file.suffix not in (".pyc", ".pth"):
                target = site / file.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, target)
        installed.add(name)
        for raw in package.requires or ():
            requirement = Requirement(raw)
            if not requirement.marker or requirement.marker.evaluate({"extra": ""}):
                pending.append(requirement.name)
    print(child)


if __name__ == "__main__":
    directory = Path(sys.argv[1]).resolve()
    if directory.exists():
        raise SystemExit("Choose a new temporary directory for the isolated interpreter")
    prepare(directory, sys.argv[2:])
