import hashlib
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

EXTENSION = Path(__file__).resolve().parents[1] / "extension"
sys.path.insert(0, str(EXTENSION))
import install_dfu


class ProbeDeploymentTests(unittest.TestCase):
    def test_verified_portable_binary_is_complete_and_failed_update_preserves_it(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            output = io.BytesIO()
            with tarfile.open(mode="w:xz", fileobj=output) as fixture:
                for arch in ["win64", "win32"]:
                    member = tarfile.TarInfo(f"{install_dfu.RELEASE}/{arch}/dfu-util-static.exe")
                    payload = arch.encode("ascii")
                    member.size = len(payload)
                    fixture.addfile(member, io.BytesIO(payload))

            archive = output.getvalue()
            def download(url, file):
                self.assertEqual(url, install_dfu.URL)
                file.write_bytes(archive)

            with patch.object(install_dfu, "SHA256", hashlib.sha256(archive).hexdigest()):
                for arch in ["win64", "win32"]:
                    exe = install_dfu.install(directory, arch, download)
                    self.assertEqual(exe.read_bytes(), arch.encode("ascii"))
                with self.assertRaises(KeyError):
                    install_dfu.install(directory, "missing", download)
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                install_dfu.install(directory, "win64", download)
            self.assertEqual(exe.read_bytes(), b"win32")
            self.assertEqual(list(directory.iterdir()), [exe])
