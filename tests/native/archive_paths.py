"""Inspect a release VSIX for build-machine paths accidentally shipped in text files."""

import argparse
import os
import re
import sys
import zipfile
from pathlib import Path

TEXT = {'.js', '.cjs', '.mjs', '.py', '.json', '.html', '.css', '.md', '.svg', '.map', '.yml', '.yaml'}
CODE = TEXT - {'.md', '.svg', '.map'}
PERSONAL_PATH = re.compile(r"""["'`](?:[A-Za-z]:[/\\](?=[\w.])|/(?:Users|home)/(?!Shared/)[\w.-]+/)""")


def normalized(text):
    return text.replace('\\\\', '/').replace('\\', '/').casefold()


def local_roots(extra):
    candidates = [Path.home(), Path(__file__).resolve().parents[2], *extra]
    for key in ('ZEPHYR_BASE', 'ZEPHYR_SDK_INSTALL_DIR', 'VIRTUAL_ENV'):
        value = os.environ.get(key)
        if value and Path(value).is_absolute():
            candidates.append(Path(value))
    return {normalized(str(path.resolve())).rstrip('/') for path in candidates
            if path.is_absolute() and path != Path(path.anchor)}


def inspect(vsix, roots):
    issues = []
    with zipfile.ZipFile(vsix) as archive:
        for member in archive.namelist():
            file = Path(member)
            if not member.startswith('extension/') or file.suffix.lower() not in TEXT:
                continue
            text = archive.read(member).decode('utf-8')
            portable = normalized(text)
            if any(root + '/' in portable or root + '"' in portable or root + "'" in portable for root in roots):
                issues.append(f'{member}: includes a local build or user directory')
            # Examples and vendor implementations may illustrate platform-specific paths.
            authored = not {'node_modules', 'vendor'}.intersection(file.parts)
            if authored and file.suffix.lower() in CODE:
                for number, line in enumerate(text.splitlines(), 1):
                    if PERSONAL_PATH.search(line):
                        issues.append(f'{member}:{number}: check the literal drive or home directory')
    return issues


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('vsix', type=Path)
    parser.add_argument('--forbid-root', action='append', type=Path, default=[])
    args = parser.parse_args()
    problems = inspect(args.vsix, local_roots(args.forbid_root))
    if problems:
        sys.exit('\n'.join(problems))
    print(f'No workstation path found in the packaged text of {args.vsix.name}.')
