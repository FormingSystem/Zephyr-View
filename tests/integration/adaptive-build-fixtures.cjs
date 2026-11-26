'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function write(root, relative, text) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, text);
  return file;
}

const stack = value => 'CONFIG_MAIN_STACK_SIZE=' + value + '\n';
const model = value => '/ { model = "' + value + '"; };\n';

async function application(root, name, declarations, files) {
  const dir = path.join(root, name);
  await write(dir, 'CMakeLists.txt', [
    'cmake_minimum_required(VERSION 3.28)',
    ...declarations,
    'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',
    'project(adaptive_test)',
    'target_sources(app PRIVATE main.c)', ''
  ].join('\n'));
  await write(dir, 'main.c', 'int main(void) { return 0; }\n');
  for (const [file, value] of Object.entries(files)) await write(dir, file, value);
  return dir;
}

async function fixtures(root, base) {
  const app = await application(root, 'dynamic-app', [
    'set(BOARD mps2/an386)',
    'function(use_profile prefix)',
    '  set("${prefix}_FILE" profiles/shipping.conf PARENT_SCOPE)',
    'endfunction()',
    'use_profile(CONF)'
  ], {'profiles/shipping.conf': stack(2048), 'unrelated.conf': stack(3328)});
  const empty = await application(root, 'empty-app', [], {'unused.conf': stack(3328)});
  const alias = await write(root, 'aliases.cmake', 'set(lab_smp_BOARD_ALIAS qemu_riscv32/qemu_virt_riscv32/smp)\n');

  // The board directory contains no DTS. Zephyr supplies boards/common/stub.dts and
  // the independently selected hardware overlay supplies the peripherals for this fixture.
  const boardRoot = path.join(root, 'board-root');
  const board = path.join(boardRoot, 'boards/others/adaptive_fixture');
  await write(board, 'board.yml', 'board:\n  name: adaptive_fixture\n  full_name: Adaptive fixture\n  vendor: others\n  socs:\n    - name: an386\n');
  await write(board, 'Kconfig.adaptive_fixture', 'config BOARD_ADAPTIVE_FIXTURE\n\tselect SOC_AN386\n');
  await write(board, 'adaptive_fixture_defconfig', '');
  const reference = path.join(base, 'boards/arm/mps2');
  const dts = await fs.readFile(path.join(reference, 'mps2_an386.dts'), 'utf8');
  const hardware = dts.replace('/dts-v1/;', '').replace(/#include "(.*?)"/g,
    (_, file) => '#include "' + path.resolve(reference, file).split(path.sep).join('/') + '"');
  const stubApp = await application(root, 'stub-app', [], {'prj.conf': stack(2048), 'app.overlay': hardware});
  const external = path.join(root, 'external');
  const conf = [await write(external, 'policy.conf', stack(2304)), await write(external, 'target.conf', stack(3072))];
  const overlays = [await write(external, 'base.overlay', model('policy')), await write(external, 'variant.overlay', model('variant'))];
  const sample = path.join(base, 'samples/shields/npm2100_ek');
  return [
    {id:'app-owned', method:'CMake', app, board:null, expectedBoard:'mps2', machine:40, stack:2048, conf:'shipping.conf', overlayCount:0},
    {id:'empty-alias', method:'west', app:empty, board:'lab_smp', expectedBoard:'qemu_riscv32', machine:243,
      args:['CONF_FILE='], env:{ZEPHYR_BOARD_ALIASES:alias}, empty:true, overlayCount:0},
    {id:'stub', method:'CMake', app:stubApp, board:'adaptive_fixture', expectedBoard:'adaptive_fixture', machine:40,
      args:['BOARD_ROOT=' + boardRoot.split(path.sep).join('/')], baseDts:'stub.dts', overlay:'app.overlay'},
    {id:'shield', method:'west', app:sample, board:'nrf52840dk/nrf52840', expectedBoard:'nrf52840dk', machine:40,
      overlay:'npm2100_ek_buttons.overlay'},
    {id:'manual', method:'CMake', app:await application(root, 'manual-app', [
        'set(APPLICATION_CONFIG_DIR "${CMAKE_CURRENT_SOURCE_DIR}/profiles")'
      ], {'profiles/prj.conf':stack(1536), 'profiles/app.overlay':model('shipping')}),
      board:'qemu_x86/atom', expectedBoard:'qemu_x86', machine:3, manual:{conf,overlays}, stack:1536, overlay:'app.overlay', model:'shipping'}
  ];
}

module.exports = {fixtures};
