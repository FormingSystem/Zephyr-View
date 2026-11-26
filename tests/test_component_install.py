import hashlib
import importlib.util
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

EXTENSION = Path(__file__).resolve().parents[1] / "extension"


def helper(name):
    spec = importlib.util.spec_from_file_location(name, EXTENSION / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sdk = helper("install_sdk")
python = helper("install_python")


class ComponentInstallTests(unittest.TestCase):
    def test_python_preflight_checks_versions_and_markers_without_installing(self):
        with tempfile.TemporaryDirectory() as temp:
            requirements = Path(temp) / "requirements-base.txt"
            requirements.write_text("missing-guided-fixture==1.0\nother; python_version < '2'\n")
            report = python.inspect_environment(requirements)
            self.assertIsInstance(report["venv"], bool)
            if "missing" in report:  # Some bare system Pythons have no packaging or pip.
                self.assertEqual(report["missing"], ["missing-guided-fixture"])
            requirements.write_text("-r unavailable.txt\n")
            self.assertNotIn("missing", python.inspect_environment(requirements))

    def test_sdk_bundle_matches_the_python_host_used_by_west(self):
        for system, machine, host in [
            ("win32", "AMD64", "windows-x86_64"), ("linux", "x86_64", "linux-x86_64"),
            ("linux", "aarch64", "linux-aarch64"), ("darwin", "arm64", "macos-aarch64"),
            ("darwin", "x86_64", "macos-x86_64"),
        ]:
            with self.subTest(host=host), patch.object(sys, "platform", system), patch.object(platform, "machine", return_value=machine):
                self.assertEqual(sdk.host_id(), host)
                self.assertEqual(sdk.check_host(f"zephyr-sdk-1.0.1_{host}_gnu.tar.xz"), "1.0.1")
                with self.assertRaisesRegex(ValueError, "Expected a full Zephyr SDK bundle"):
                    sdk.check_host("zephyr-sdk-1.0.1_windows-aarch64_gnu.7z")

    def test_archive_cannot_escape_sdk_directory(self):
        for member in ("../outside", "zephyr-sdk-x/../other", "C:/x", "zephyr-sdk-x\\..\\outside"):
            with self.subTest(member=member), self.assertRaises(ValueError):
                sdk.check_paths([member], "zephyr-sdk-x")

    @unittest.skipUnless(shutil.which("cmake"), "CMake is required for bundle integration")
    def test_offline_sdk_validates_hash_and_host_and_reserves_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            source = parent / "zephyr-sdk-1.0.1"
            source.mkdir()
            (source / "sdk_version").write_text("1.0.1\n")
            (source / "setup.cmd").write_text("@echo off\n@echo %* > setup-arguments.txt\n")
            (source / "setup.sh").write_text('printf "%s" "$*" > setup-arguments.txt\n')
            system = {"win32": "windows", "linux": "linux", "darwin": "macos"}[sys.platform]
            machine = {"amd64": "x86_64", "arm64": "aarch64"}.get(platform.machine().lower(), platform.machine().lower())
            base = f"zephyr-sdk-1.0.1_{system}-{machine}_gnu"
            if system == "windows":
                bundle = parent / (base + ".7z")
                subprocess.run(["cmake", "-E", "tar", "cf", bundle, "--format=7zip", source.name], cwd=parent, check=True)
            else:
                bundle = parent / (base + ".tar.xz")
                with tarfile.open(bundle, "w:xz") as archive:
                    archive.add(source, arcname=source.name)
            manifest = parent / "sha256.sum"
            destination = parent / "my sdk"
            args = type("Args", (), {"destination": destination, "cmake": shutil.which("cmake"), "release": None,
                                     "archive": bundle, "checksums": manifest, "register": False})
            manifest.write_text("0" * 64 + "  " + bundle.name)
            with patch.object(sdk, "fetch", side_effect=AssertionError("network requested")):
                with self.assertRaisesRegex(ValueError, "SHA-256"):
                    sdk.install(args)
                self.assertFalse(destination.exists())
                manifest.write_text(hashlib.sha256(bundle.read_bytes()).hexdigest() + " *" + bundle.name)
                sdk.install(args)
                self.assertEqual((destination / "setup-arguments.txt").read_text().strip(),
                                 "/h" if system == "windows" else "-h")
                with self.assertRaises(FileExistsError):
                    sdk.install(args)
            with self.assertRaises(ValueError):
                sdk.check_host("zephyr-sdk-1.0.1_amiga-m68k_gnu.7z")

    def test_offline_requirements_include_nested_files_and_block_remote_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            main = root / "requirements-base.txt"
            nested = root / "tools.txt"
            main.write_text("-r tools.txt\n")
            nested.write_text("west>=1.0; python_version > '3.8'\n")
            python.check_requirements(main, set())
            for line in ("pkg @ https://example.invalid/pkg.whl", "--find-links https://example.invalid/"):
                nested.write_text(line)
                with self.assertRaisesRegex(ValueError, "Offline mode"):
                    python.check_requirements(main, set())

    def test_failure_after_unpack_allows_retry_at_same_path(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            directory = parent / "new installation"
            payload = parent / "payload"
            payload.mkdir()
            (payload / "setup.sh").touch()
            sentinel = parent / "unrelated"
            sentinel.write_text("preserved")
            with patch.object(sdk, "run_setup", side_effect=OSError("failed setup")):
                with self.assertRaisesRegex(OSError, "failed setup"):
                    sdk.publish(payload, directory, False)
            self.assertFalse(directory.exists())
            self.assertEqual(sentinel.read_text(), "preserved")
            (payload / "setup.sh").touch()
            with patch.object(sdk, "run_setup"):
                sdk.publish(payload, directory, False)
            self.assertTrue((directory / "setup.sh").exists())

    def test_offline_west_installs_into_chosen_virtual_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            info = "west-0.0.1.dist-info"
            archive = root / "west-0.0.1-py3-none-any.whl"
            metadata = "Metadata-Version: 2.1\nName: west\nVersion: 0.0.1\n"
            with zipfile.ZipFile(archive, "w") as wheel:
                wheel.writestr("west/__init__.py", "")
                wheel.writestr(info + "/METADATA", metadata)
                wheel.writestr(info + "/WHEEL", "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
                wheel.writestr(info + "/RECORD", "")
            destination = root / "python venv"
            args = type("Args", (), {"destination": destination, "existing": False, "requirements": None, "wheels": str(root)})
            python.install(args)
            executable = destination / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            subprocess.run([executable, "-c", "import west"], check=True)
            with self.assertRaises(FileExistsError):
                python.install(args)
            with zipfile.ZipFile(root / "extra.whl", "w") as wheel:
                wheel.writestr("extra.dist-info/METADATA", "Requires-Dist: demo @ https://example.invalid/s.whl\n")
            with self.assertRaisesRegex(ValueError, "Remote dependency"):
                python.check_wheels(root)


if __name__ == "__main__":
    unittest.main()
