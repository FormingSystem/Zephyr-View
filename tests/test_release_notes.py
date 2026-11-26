"""Exercise the same notes-file generation command maintainers use to publish."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "release_notes.py"


class ReleaseNotesTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.chinese = root / "中文.md"
        self.english = root / "English notes.md"
        self.output = root / "release.md"

    def render(self):
        return subprocess.run([sys.executable, str(SCRIPT), "--zh", str(self.chinese),
                               "--en", str(self.english), "--output", str(self.output)],
                              capture_output=True)

    def test_language_controls_wrap_original_markdown(self):
        chinese = "- 安装 [VSIX](https://example.org/tool.vsix)"
        english = "    west build\n\n1. Verify the build."
        self.chinese.write_bytes((chinese + "\r\n").encode("utf-8-sig"))
        self.english.write_text(english, encoding="utf-8")
        result = self.render()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_bytes().decode("utf-8"),
                         f"<details>\n<summary>简体中文</summary>\n\n{chinese}\n\n</details>\n\n"
                         f"<details>\n<summary>English</summary>\n\n{english}\n\n</details>\n")

    def test_empty_translation_keeps_previous_notes(self):
        self.chinese.write_text("已安装", encoding="utf-8")
        self.english.write_text("  \n", encoding="utf-8")
        self.output.write_text("previous release", encoding="utf-8")
        self.assertNotEqual(self.render().returncode, 0)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "previous release")


if __name__ == "__main__":
    unittest.main()
