"""Check source/translation pairs. Record one reviewed pair with --record path/to/source.md."""
import hashlib
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
REGISTER = Path(__file__).with_name("bilingual-docs.json")
LINK = re.compile(r'\[[^\]\n]*\]\(([^)\s]+)\)')


def documents():
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
        cwd=ROOT,
    )
    return {name for name in names.decode("utf-8").split("\0") if name}


def peer(path):
    if path.name.endswith(".en.md"):
        return path.with_name(path.name[:-6] + ".md")
    return path.with_suffix(".en.md")


def source_digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def body_lines(text):
    fence = None
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker and (fence is None or marker[1].startswith(fence)):
            fence = None if fence else marker[1]
        elif not fence:
            yield line


def anchors(lines):
    result = set()
    for line in lines:
        result.update(re.findall(r'<a\s+(?:id|name)="([^"]+)"', line))
        title = re.match(r"^#{1,6}\s+(.+)", line)
        if title:
            slug = re.sub(r"[^\w\s-]", "", title[1].lower()).replace(" ", "-")
            candidate = slug
            count = 0
            while candidate in result:
                count += 1
                candidate = f"{slug}-{count}"
            result.add(candidate)
    return result


class BilingualDocs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.names = documents()
        cls.pages = {ROOT / name: (ROOT / name).read_text(encoding="utf-8") for name in cls.names}
        cls.anchors = {path: anchors(body_lines(text)) for path, text in cls.pages.items()}

    def test_reviewed_source_versions(self):
        register = json.loads(REGISTER.read_text(encoding="utf-8"))
        sources = {name for name in self.names if not name.endswith(".en.md")}
        self.assertEqual(set(register), sources, "Update the register when adding or removing a pair")
        for name in sorted(sources):
            with self.subTest(name=name):
                self.assertEqual(register[name], source_digest(self.pages[ROOT / name]),
                                 "Review the translation and record this pair with --record")

    def test_language_switches_and_links(self):
        for page, text in self.pages.items():
            with self.subTest(page=page.relative_to(ROOT)):
                counterpart = peer(page)
                self.assertTrue(counterpart in self.pages, f"Missing translation: {counterpart.name}")
                english = page.name.endswith(".en.md")
                switch = (f"[简体中文]({counterpart.name}) | **English**" if english else
                          f"**简体中文** | [English]({counterpart.name})")
                lines = [line for line in body_lines(text) if line.strip()]
                self.assertTrue(lines[0].startswith("# "))
                self.assertEqual(lines[1], switch)
                self.assertEqual(lines[-1], switch)
                self.assertEqual(lines.count(switch), 2)
                for line in lines[2:-1]:
                    for href in LINK.findall(line):
                        ref = urlsplit(href)
                        if ref.scheme or ref.netloc:
                            continue
                        dest = (page.parent / unquote(ref.path)).resolve() if ref.path else page
                        self.assertTrue(dest.exists(), f"{href} from {page.name}")
                        if dest in self.pages:
                            self.assertEqual(dest.name.endswith(".en.md"), english, href)
                            if ref.fragment:
                                self.assertIn(unquote(ref.fragment), self.anchors[dest], href)


def record(name):
    path = ROOT / name
    if name not in documents() or name.endswith(".en.md") or not peer(path).is_file():
        raise SystemExit("Provide a repository-relative path to a reviewed Chinese/English pair")
    register = json.loads(REGISTER.read_text(encoding="utf-8")) if REGISTER.exists() else {}
    register[name] = source_digest(path.read_text(encoding="utf-8"))
    REGISTER.write_text(json.dumps(register, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--record":
        record(sys.argv[2])
    else:
        unittest.main()
