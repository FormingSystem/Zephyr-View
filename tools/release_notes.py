"""Format Chinese and English Markdown for a GitHub Release description."""
import argparse
from pathlib import Path


def render_release_notes(chinese: str, english: str) -> str:
    sections = []
    for language, body in (("简体中文", chinese), ("English", english)):
        if not body.strip():
            raise ValueError(f"Release notes are empty for {language}")
        markdown = body.strip("\n")
        sections.append(f"<details>\n<summary>{language}</summary>\n\n{markdown}\n\n</details>")
    return "\n\n".join(sections) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zh", type=Path, required=True, help="Chinese Markdown file")
    parser.add_argument("--en", type=Path, required=True, help="English Markdown file")
    parser.add_argument("--output", type=Path, required=True, help="Markdown for the release editor")
    args = parser.parse_args()
    if len({path.resolve() for path in (args.zh, args.en, args.output)}) != 3:
        parser.error("Choose separate files for each language and the output")
    try:
        notes = render_release_notes(args.zh.read_text(encoding="utf-8-sig"),
                                     args.en.read_text(encoding="utf-8-sig"))
        args.output.write_bytes(notes.encode("utf-8"))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
