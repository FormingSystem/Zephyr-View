"""Run the extension regression suites on the current operating system."""

import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def verify_windows_desktop(expected):
    if sys.platform != 'win32' or sys.getwindowsversion().product_type != 1:
        raise SystemExit(f'This check requires a Windows {expected} client edition.')
    major, _, build = sys.getwindowsversion().platform_version
    actual = '11' if build >= 22000 else '10'
    if major != 10 or actual != expected:
        raise SystemExit(f'Expected Windows {expected}, detected NT {major} build {build}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--windows-desktop', choices=['10', '11'])
    options = parser.parse_args()
    if options.windows_desktop:
        verify_windows_desktop(options.windows_desktop)
    print(f'{platform.platform()} ({platform.machine()}) · Python {platform.python_version()}', flush=True)
    for tool in ('cmake', 'node'):
        if not shutil.which(tool):
            raise SystemExit(f'{tool} is required on PATH')
        subprocess.run([tool, '--version'], check=True)
    tests = sorted((ROOT / 'tests').glob('*.test.js'))
    subprocess.run(['node', '--test', *tests], cwd=ROOT, check=True)
    subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-v', '-s', 'tests', '-p', 'test_*.py'],
                   cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
