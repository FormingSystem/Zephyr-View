"""Build the six Thread Studio exercises for mps2/an386 and check their QEMU output."""

import argparse
import asyncio
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = """
const model = require('./extension/media/threadStudio/model');
const projects = {};
for (const kind of model.kinds) {
  for (const creation of ['static', 'dynamic']) {
    projects[kind + '-' + creation] = model.generate({...model.defaults(kind), creation});
  }
}
process.stdout.write(JSON.stringify(projects));
"""


def expected_serial(kind, lines):
    if kind == 'mutex':
        observations = [m.groups() for line in lines
                        if (m := re.fullmatch(r'worker ([AB]): counter=([12])', line))]
        return len(observations) == 2 and (
            {name for name, _ in observations} == {'A', 'B'}
            and {value for _, value in observations} == {'1', '2'})
    return {'msgq': 'received 42', 'sem': 'permit acquired'}[kind] in lines


async def inspect_serial(qemu, elf, kind, timeout):
    process = await asyncio.create_subprocess_exec(
        qemu, '-machine', 'mps2-an386', '-cpu', 'cortex-m4', '-display', 'none',
        '-monitor', 'none', '-serial', 'stdio', '-kernel', str(elf),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    lines = []

    async def observe():
        while raw := await process.stdout.readline():
            lines.append(raw.decode(errors='replace').strip())
            if expected_serial(kind, lines):
                return True
        return False

    try:
        if await asyncio.wait_for(observe(), timeout):
            return ' | '.join(line for line in lines if line and not line.startswith('***'))
    except asyncio.TimeoutError:
        pass
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.communicate()
    raise RuntimeError(f'Expected {kind} output did not arrive from QEMU:\n' + '\n'.join(lines[-20:]))


def check_project(work, name, files, options):
    app = work / name
    build = work / (name + '-build')
    for filename, source in files.items():
        target = app / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding='utf-8')
    configure = ['cmake', '-S', app, '-B', build, '-G', 'Ninja', '-DBOARD=mps2/an386',
                 '-DPython3_EXECUTABLE=' + Path(sys.executable).as_posix()]
    if options.module:
        configure.append('-DZEPHYR_MODULES=' + ';'.join(p.resolve().as_posix() for p in options.module))
    subprocess.run(configure, check=True)
    if options.require_no_west:
        cache = (build / 'CMakeCache.txt').read_text(encoding='utf-8')
        if not re.search(r'^WEST:[^=]+=WEST-NOTFOUND$', cache, re.MULTILINE):
            raise RuntimeError(f'{name}: use a Zephyr build Python without west and supply local modules')
    subprocess.run(['cmake', '--build', build], check=True)
    return asyncio.run(inspect_serial(options.qemu, build / 'zephyr/zephyr.elf',
                                      name.split('-')[0], options.timeout))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module', type=Path, action='append', default=[],
                        help='Local Zephyr module root; repeat to set the complete ZEPHYR_MODULES list')
    parser.add_argument('--qemu', default='qemu-system-arm', help='ARM QEMU executable path or name on PATH')
    parser.add_argument('--timeout', type=int, default=20, help='Maximum seconds per QEMU run')
    parser.add_argument('--require-no-west', action='store_true', help='Check CMake records WEST-NOTFOUND')
    options = parser.parse_args()
    if options.timeout < 1:
        parser.error('--timeout must be positive')
    for program in ('cmake', 'ninja', 'node', options.qemu):
        if not shutil.which(program):
            parser.error(f'Executable not found: {program}')
    for directory in options.module:
        if not directory.is_dir():
            parser.error(f'Module directory not found: {directory}')
    generated = subprocess.check_output(['node', '-e', GENERATOR], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='zephyr-thread-studio-') as work:
        results = {name: check_project(Path(work), name, files, options)
                   for name, files in json.loads(generated).items()}
    for name, serial in results.items():
        print(f'{name}: {serial}')


if __name__ == '__main__':
    main()
