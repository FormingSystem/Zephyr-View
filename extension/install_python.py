"""Install west or the checkout's build requirements in a workspace environment."""
import argparse
import email
import importlib.metadata
import importlib.util
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path


def inspect_environment(requirements):
    """Inspect local distributions and venv support without resolving or installing packages."""
    pip = importlib.util.find_spec("pip") is not None
    venv = importlib.util.find_spec("venv") is not None and importlib.util.find_spec("ensurepip") is not None
    result = {"venv": venv or (sys.prefix != sys.base_prefix and pip), "activeVenv": sys.prefix if sys.prefix != sys.base_prefix and pip else None}
    if not requirements:
        return result
    try:
        try:
            from packaging.requirements import Requirement
        except ImportError:
            from pip._vendor.packaging.requirements import Requirement
        missing = []
        lines = re.sub(r"\\\r?\n", " ", Path(requirements).read_text(encoding="utf-8"))
        for raw in lines.splitlines():
            line = re.split(r"\s+#", raw, maxsplit=1)[0].strip()
            if not line or line.startswith("#"):
                continue
            req = Requirement(line)
            if req.marker and not req.marker.evaluate():
                continue
            try:
                version = importlib.metadata.version(req.name)
                if req.url or req.extras:
                    return result  # The exact source or extras need pip's resolver.
                if not req.specifier or req.specifier.contains(version, prereleases=True):
                    continue
            except importlib.metadata.PackageNotFoundError:
                pass
            missing.append(req.name)
        result["missing"] = missing
    except (ImportError, ValueError, OSError):
        pass  # Local inspection cannot resolve every supported pip requirements-file format.
    return result

def offline_requirement(value):
    """Only named packages may be resolved from a local wheelhouse."""
    spec = value.split(";", 1)[0].strip()
    return bool(re.fullmatch(r"[A-Za-z0-9][\w.-]*(?:\[[\w., -]+\])?\s*"
                             r"(?:[~<>=!][A-Za-z0-9.*+!~=<> ,_-]+|\([~<>=!][\w.*+!~=<> ,-]+\))?", spec))


def check_requirements(file, seen):
    file = file.resolve(strict=True)
    if file in seen:
        return
    seen.add(file)
    lines = re.sub(r"\\\r?\n", " ", file.read_text(encoding="utf-8"))
    for raw in lines.splitlines():
        line = re.split(r"\s+#", raw, maxsplit=1)[0].strip()
        if not line or line.startswith("#"):
            continue
        include = re.fullmatch(r"(?:-r|--requirement[= ]|-c|--constraint[= ])\s*(.+)", line)
        if include and "://" not in include[1] and not include[1].startswith(("//", "\\\\")):
            check_requirements(file.parent / include[1], seen)
        elif not offline_requirement(line):
            raise ValueError(f"Offline mode requires named wheel packages: {file.name}: {line}")


def check_wheels(directory):
    wheels = list(directory.glob("*.whl"))
    if not wheels:
        raise ValueError(f"No .whl files in {directory}")
    for wheel in wheels:
        with zipfile.ZipFile(wheel) as package:
            for name in package.namelist():
                if not name.endswith(".dist-info/METADATA"):
                    continue
                meta = email.message_from_bytes(package.read(name))
                for dependency in meta.get_all("Requires-Dist", []):
                    if "@" in dependency.split(";", 1)[0] or "://" in dependency:
                        raise ValueError(f"Remote dependency in {wheel.name}: {dependency}")


def prepare(directory, existing):
    if existing:
        if not (directory / "pyvenv.cfg").is_file():
            raise ValueError(f"Not a Python virtual environment: {directory}")
    else:
        directory.mkdir()
        subprocess.run([sys.executable, "-m", "venv", directory], check=True)
    windows = sys.platform == "win32"
    return directory / ("Scripts" if windows else "bin") / ("python.exe" if windows else "python")


def install(args):
    sources = ["-r", args.requirements] if args.requirements else ["west"]
    offline = []
    env = dict(os.environ)
    if args.wheels:
        if args.requirements:
            check_requirements(Path(args.requirements), set())
        check_wheels(Path(args.wheels))
        offline = ["--no-index", "--find-links", args.wheels, "--only-binary=:all:",
                   "--ignore-installed", "--no-cache-dir"]
        # Ignore pip configurations that could add other package repositories.
        env = {key: value for key, value in env.items() if not key.upper().startswith("PIP_")}
        env["PIP_CONFIG_FILE"] = os.devnull
    python = prepare(Path(args.destination), args.existing)
    subprocess.run([python, "-m", "pip", "--disable-pip-version-check", "install", *offline, *sources],
                   env=env, check=True)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--inspect"]:
        print(json.dumps(inspect_environment(sys.argv[2] if len(sys.argv) == 3 else None)))
        sys.exit(0)
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", required=True)
    parser.add_argument("--existing", action="store_true")
    parser.add_argument("--wheels")
    parser.add_argument("--requirements")
    try:
        install(parser.parse_args())
    except (OSError, ValueError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        sys.exit(str(error))
