"""Install the upstream Windows dfu-util executable in the extension's tools directory."""

import argparse
import hashlib
import os
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

from install_sdk import fetch

RELEASE = "dfu-util-0.11-binaries"
URL = f"https://downloads.sourceforge.net/project/dfu-util/{RELEASE}.tar.xz"
# Published with the same archive at sourceforge.net/projects/dfu-util/files/.
SHA256 = "6450de30a7dcd8d8c1273f43f0b153f054fd24d85f7f38296b1ad8edbd2ddb25"


def install(directory, architecture, download=fetch):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "dfu-util.exe"
    with tempfile.TemporaryDirectory(dir=directory) as staging:
        archive = Path(staging) / "package.tar.xz"
        download(URL, archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            raise ValueError("dfu-util archive SHA-256 mismatch")
        staged = Path(staging) / target.name
        with tarfile.open(archive, "r:xz") as package:
            member = package.getmember(f"{RELEASE}/{architecture}/dfu-util-static.exe")
            if not member.isfile():
                raise ValueError("Windows executable missing from the verified archive")
            with package.extractfile(member) as source, staged.open("xb") as output:
                shutil.copyfileobj(source, output)
        os.replace(staged, target)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("architecture", choices=["win32", "win64"])
    args = parser.parse_args()
    try:
        print(install(args.directory, args.architecture))
    except (OSError, ValueError, tarfile.TarError, KeyError) as error:
        sys.exit(str(error))
