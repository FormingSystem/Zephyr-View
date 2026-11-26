"""Build and run a visual Zephyr program, then replay the observed QEMU console events."""

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

from thread_firmware import ROOT, configure_project, firmware_options, read_serial_until


GENERATE = """
const m = require('./extension/media/threadStudio/programModel');
const graph = m.example();
graph.creation = process.argv[1];
graph.threads[0].initialValue = Number(process.argv[2]);
graph.threads[0].steps.unshift({id:'read_driver',op:'external',symbol:'read_sensor'});
graph.objects.push({id:'counter',name:'counter',kind:'mutex'});
graph.threads[1].steps.push({id:'count',op:'increment',object:'counter'}, {id:'print_count',op:'print'});
graph.threads[2].steps.push({id:'print_ready',op:'print'});
graph.mainSteps.push({id:'twice',op:'repeat',count:2,steps:[
  {id:'wait_tick',op:'delay',value:1}, {id:'add_tick',op:'add',value:3}
]}, {id:'print_main',op:'print'});
console.log(JSON.stringify({graph, files:m.generate(graph)}));
"""

REPLAY = """
const fs = require('node:fs');
const trace = require('./extension/media/threadStudio/programTrace');
const capture = JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(trace.parse(capture.serial, capture.graph)));
"""


def generate(app, creation, initial):
    output = subprocess.check_output(['node', '-e', GENERATE, creation, str(initial)], cwd=ROOT)
    project = json.loads(output)
    for name, content in project['files'].items():
        file = app / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding='utf-8')
    return project['graph']


def expected_steps(value):
    result = value * 2 if value >= 40 else value + 1
    path = 'then' if value >= 40 else 'else'
    return {
        'sensor': [('read_driver', 'external', value), ('publish', 'send', value)],
        'relay': [('read', 'receive', value), ('threshold', 'if-' + path, value),
                  ('double', 'multiply', result) if path == 'then' else ('offset', 'add', result),
                  ('process', 'call', result), ('result', 'print', result),
                  ('notify', 'give', result), ('count', 'increment', 1), ('print_count', 'print', 1)],
        'logger': [('await_ready', 'take', 42), ('print_ready', 'print', 42)],
        '$main': [('startup', 'set', 1), ('boot_output', 'print', 1), ('wait_tick', 'delay', 1),
                  ('add_tick', 'add', 4), ('wait_tick', 'delay', 4), ('add_tick', 'add', 7),
                  ('twice', 'repeat', 7), ('print_main', 'print', 7)]
    }


def check_capture(lines, graph, expected):
    capture = json.dumps({'graph': graph, 'serial': '\n'.join(lines)})
    result = json.loads(subprocess.check_output(['node', '-e', REPLAY], cwd=ROOT, input=capture.encode()))
    if result['truncated'] or any(row['kind'] != 'event' for row in result['rows']):
        raise AssertionError(f"Incomplete or unrecognized capture: {result['counts']}")
    actual = {}
    for event in result['rows']:
        actual.setdefault(event['contextId'], []).append((event['stepId'], event['op'], event['value']))
    if actual != expected:
        raise AssertionError(f'Expected {expected}\nReceived {actual}')
    return result['counts']['event']


def build_and_observe(build, elf, graph, trace, value, options):
    subprocess.run(['cmake', '--build', build], check=True)
    expected = expected_steps(value) if trace else {}
    transformed = value * 2 if value >= 40 else value + 1
    outputs = {f'relay value={transformed}', 'relay value=1', 'logger value=42', '$main value=7'}
    minimum = sum(len(steps) for steps in expected.values())

    def complete(lines):
        return outputs.issubset(lines) and sum(line.startswith('ZVTRACE ') for line in lines) >= minimum

    lines = asyncio.run(read_serial_until(options.qemu, elf, complete, options.timeout))
    count = check_capture(lines, graph, expected)
    return f'driver={value}, result={transformed}, counter=1, main=7, trace events={count}'


def run_case(directory, creation, trace, options):
    initial = 42 if creation == 'static' else 5
    label = f'{creation}-trace-{"on" if trace else "off"}'
    app, build = directory / label, directory / (label + '-build')
    graph = generate(app, creation, initial)
    elf = configure_project(app, build, options, '-DZV_TRACE=' + ('ON' if trace else 'OFF'))
    results = [(label, build_and_observe(build, elf, graph, trace, initial, options))]
    if trace and creation == 'static':
        with (app / 'src/user_hooks.c').open('a', encoding='utf-8') as hooks:
            hooks.write('\nuint32_t zv_hook_read_sensor(uint32_t value) { return value - 9U; }\n')
        results.append((label + '-strong-hook', build_and_observe(build, elf, graph, trace, initial - 9, options)))
    return results


def main():
    options = firmware_options(__doc__)
    results = []
    with tempfile.TemporaryDirectory(prefix='zephyr-visual-program-') as temp:
        for creation, trace in [('static', True), ('dynamic', True), ('static', False)]:
            results.extend(run_case(Path(temp), creation, trace, options))
    for name, evidence in results:
        print(f'{name}: {evidence}')


if __name__ == '__main__':
    main()
