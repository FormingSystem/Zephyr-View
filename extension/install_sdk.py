"""Install a complete SDK bundle using its release checksum and bundled setup."""
import argparse
import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from urllib.request import Request, urlopen
from urllib.parse import quote

RELEASES = "https://github.com/zephyrproject-rtos/sdk-ng/releases/download"
BUNDLE = re.compile(r"zephyr-sdk-(?P<version>\d+\.\d+\.\d+(?:[-+][\w.-]+)?)_"
                    r"(?P<host>linux|windows|macos)-(?P<arch>x86_64|aarch64)"
                    r"(?:_(?:gnu|llvm))?\.(?:tar\.(?:xz|gz|zst)|7z|zip)$")


def host_id():
    """Use the working interpreter's ABI, just as west sdk does on this host."""
    host = {"win32": "windows", "darwin": "macos", "linux": "linux"}.get(sys.platform)
    machine = platform.machine().lower()
    arch = {"amd64": "x86_64", "arm64": "aarch64"}.get(machine, machine)
    if host is None or arch not in ("x86_64", "aarch64"):
        raise ValueError(f"Unsupported SDK host: {sys.platform}-{machine}")
    return f"{host}-{arch}"


def check_host(filename):
    match = BUNDLE.fullmatch(filename)
    host = host_id()
    if not match or f"{match['host']}-{match['arch']}" != host:
        raise ValueError(f"Expected a full Zephyr SDK bundle for {host}: {filename}")
    return match.group("version")


def manifest_hash(manifest, filename):
    for line in manifest.read_text(encoding="utf-8-sig").splitlines():
        entry = re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?(?:\./)?(.+)", line.strip())
        if entry and entry[2] == filename:
            return entry[1].lower()
    raise ValueError(f"Checksum missing for {filename}")


def verify(archive, manifest):
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != manifest_hash(manifest, archive.name):
        raise ValueError(f"SHA-256 mismatch: {archive.name}")


def fetch(url, target):
    print(f"Downloading {url}", flush=True)
    with urlopen(Request(url, headers={"User-Agent": "Zephyr-Extension"}), timeout=60) as response:
        with target.open("xb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)


def release_bundle(temp, filename):
    version = check_host(filename)
    base = f"{RELEASES}/v{quote(version, safe='')}/"
    manifest = temp / "sha256.sum"
    fetch(base + "sha256.sum", manifest)
    manifest_hash(manifest, filename)
    archive = temp / filename
    fetch(base + quote(filename), archive)
    return archive, manifest


def check_paths(names, root):
    if not names:
        raise ValueError("Empty SDK archive")
    for name in names:
        parts = PurePosixPath(name.replace("\\", "/")).parts
        if not parts or parts[0] != root or ".." in parts or PureWindowsPath(name).drive:
            raise ValueError(f"Unexpected SDK archive member: {name}")


def unpack(archive, cmake, stage, version):
    root = "zephyr-sdk-" + version
    if tarfile.is_tarfile(archive):
        with tarfile.open(archive) as package:
            check_paths(package.getnames(), root)
            if not hasattr(tarfile, "data_filter"):
                raise ValueError("A Python interpreter with the tarfile data extraction filter is required")
            package.extractall(stage, filter="data")
    else:
        def listing(flags):
            return subprocess.check_output([cmake, "-E", "tar", flags, archive],
                                           text=True, encoding="utf-8").splitlines()
        check_paths(listing("tf"), root)
        if any(line[:1] not in ("d", "-") or " link to " in line for line in listing("tvf")):
            raise ValueError("Unsupported link or special file in SDK archive")
        subprocess.run([cmake, "-E", "tar", "xf", archive], cwd=stage, check=True)
    extracted = stage / root
    if extracted.is_symlink() or (extracted / "sdk_version").read_text().strip() != version:
        raise ValueError(f"Unexpected SDK version in {root}")
    return extracted


def install(args):
    destination = Path(args.destination).absolute()
    if os.path.lexists(destination):
        raise FileExistsError(destination)
    with tempfile.TemporaryDirectory(prefix=".zephyr-sdk-", dir=destination.parent) as staging:
        stage = Path(staging)
        if args.release:
            archive, manifest = release_bundle(stage, args.release)
        else:
            archive, manifest = Path(args.archive), Path(args.checksums)
        version = check_host(archive.name)
        verify(archive, manifest)
        if args.release and args.cache:
            cache = Path(args.cache)
            cache.mkdir()
            cached = cache / archive.name
            shutil.move(archive, cached)
            shutil.move(manifest, cache / "sha256.sum")
            archive = cached
        extracted = unpack(archive.absolute(), args.cmake, stage, version)
        publish(extracted, destination, args.register)


def publish(extracted, destination, register):
    destination.mkdir()  # Reserve the exact new directory before publishing.
    owner = destination.stat()
    try:
        for item in extracted.iterdir():
            item.rename(destination / item.name)
        run_setup(destination, register)
    except BaseException:
        # Remove this attempt's newly created SDK only. Never follow a replaced root.
        if not destination.is_symlink() and os.path.samestat(owner, destination.lstat()):
            shutil.rmtree(destination)
        raise


def run_setup(destination, register):
    windows = sys.platform == "win32"
    if windows:
        setup = [os.environ.get("ComSpec", "cmd.exe"), "/d", "/c", "setup.cmd", "/h"]
    else:
        setup = ["bash", "./setup.sh", "-h"]
    if register:
        setup.append("/c" if windows else "-c")
    subprocess.run(setup, cwd=destination, check=True)


def main():
    if sys.argv[1:] == ["--print-host"]:
        print(host_id())
        return
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--release")
    modes.add_argument("--archive")
    parser.add_argument("--checksums")
    parser.add_argument("--destination", required=True)
    parser.add_argument("--cache", help="New folder for the verified release archive and checksum")
    parser.add_argument("--cmake", required=True)
    parser.add_argument("--register", action="store_true")
    args = parser.parse_args()
    if args.archive and not args.checksums:
        parser.error("--archive requires --checksums")
    install(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        sys.exit(str(error))
