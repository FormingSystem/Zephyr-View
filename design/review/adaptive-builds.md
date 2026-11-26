# 工程自识别与原生构建对照

**简体中文** | [English](adaptive-builds.en.md)

2026-11-26，在 Windows x64、Zephyr 4.5.0-rc1（`25c8f4a23988`）、SDK 1.0.1、west 1.5.0、CMake 4.4.4 上验证。

## 五组配置能否照常编译

每个场景从独立的空目录分别用原生工具和扩展构建。扩展侧调用工作台的目标选择、文件选择、就绪检查和命令生成，然后实际执行生成的配置、编译命令。两侧从 `build_info.yml` 核对板、CPU 限定符、配置文件和设备树合并顺序，从 `.config`、`zephyr.dts` 和 ELF 头核对最终值。五组均通过。[验证入口](../../tests/integration/adaptive-build.cjs)

| 场景 | 应用或开发板 | 两侧实测结果 |
| --- | --- | --- |
| 由工程决定板和应用配置 | 应用在 `find_package(Zephyr)` 前设定 `BOARD=mps2/an386`，再用 CMake 函数构造变量名，指定 `profiles/shipping.conf`。应用根目录另有一个无关的 `.conf` | CMake 使用 Cortex-M4 板，生成 ARM ELF。栈为 2048，应用没有 overlay。工作台能定位构建记录中的相对配置文件 |
| 板别名与空配置 | west 通过 `ZEPHYR_BOARD_ALIASES` 将 `lab_smp` 映射到 `qemu_riscv32/qemu_virt_riscv32/smp`，显式传入 `CONF_FILE=` | RISC-V ELF，应用配置文件列表为空，默认栈为 1024。旁边的 `unused.conf` 没有进入构建 |
| 板目录无 DTS | `BOARD_ROOT` 中的测试板使用 AN386 SoC，板目录中没有 `.dts`；应用 overlay 提供该 MCU 构建所需的硬件节点 | CMake 使用 Zephyr 自带的 `boards/common/stub.dts`，再合并 `app.overlay`，生成 ARM ELF |
| 官方应用自选 shield 与 overlay | 官方 `samples/shields/npm2100_ek` 选择 `npm2100_ek` shield 和按键 overlay。使用 `nrf52840dk/nrf52840` | west 依次使用板 DTS、shield overlay、应用的板专用 overlay、应用指定的按键 overlay，生成 ARM ELF |
| 自定义配置目录、工程外多选与恢复 | `qemu_x86/atom` 工程把 `APPLICATION_CONFIG_DIR` 设为 `profiles`。在同一构建目录中选择工程外的两份 `.conf`、两份 overlay，然后恢复自动 | 默认来自 `profiles/prj.conf` 和 `profiles/app.overlay`，栈为 1536，型号为 `shipping`。手选后栈为 3072，型号为 `variant`。恢复后两项重回工程值，三次均生成 Intel 80386 ELF |

恢复步骤用独立的原生默认构建作为对照。扩展共执行七次实际构建，原生对照共执行六次。外部文件、测试板、日志和构建产物均保存在执行时打印的系统临时目录。

## 单用 CMake 和本机组件

在临时 Python 环境中确认无法导入 `west`，`PATH` 中也没有 west 可执行文件。扩展打开独立的 `hello_world` 应用，使用本机 SDK，通过 `ZEPHYR_MODULES` 指定 `cmsis_6`，为 `mps2/an386` 成功编译、链接出 ARM ELF。生成缓存记录 `WEST:INTERNAL=WEST-NOTFOUND`，`zephyr_modules.txt` 只列出所选模块。此测试使用本机已准备好的工具与库。复验时设置 `ZEPHYR_BASE`、`ZEPHYR_SDK_INSTALL_DIR`、`ZEPHYR_MODULES` 和准备临时环境用的 `PYTHON`，再运行 `node tests/integration/no-west-build.cjs`。[无 west 构建验证](../../tests/integration/no-west-build.cjs)

## 同一工程的两个 CPU 映像

官方 `samples/sysbuild/hello_world` 使用 nRF5340 DK。对 west 和 CMake 分别通过扩展启用 sysbuild，从空目录构建，再从同一根目录重新配置和构建。四轮均成功。按 `domains.yaml` 读取到默认域 `hello_world` 和另一域 `remote`，再到各自的 `build_info.yml` 和 ELF 核对处理器。[双映像验证入口](../../tests/integration/adaptive-sysbuild.cjs)

| 构建域 | 板与 CPU | 产物 |
| --- | --- | --- |
| `hello_world` | `nrf5340dk/nrf5340/cpuapp` | `hello_world/zephyr/zephyr.elf`，ARM |
| `remote` | `nrf5340dk/nrf5340/cpunet` | `remote/zephyr/zephyr.elf`，ARM |

顶层 CMake 工程名为 `sysbuild_toplevel`，`APP_DIR` 指向用户应用，`APPLICATION_SOURCE_DIR` 指向 Zephyr 的 sysbuild 模板。构建根目录负责所有映像，默认域提供当前应用的板级设备树和 Kconfig 信息。

另用 nRF5340 DK 样例副本，在同一构建目录验证四次配置：初始值、为应用核手选 `.conf` 和 overlay、恢复工程设置、修改应用默认文件后再次配置。后三轮应用核栈大小分别为 1536、2048 和 2816 字节，设备树 `model` 分别为 `selected`、`project` 和 `changed`。网络核的 `.config` 和 `zephyr.dts` 在全部四轮中逐字节一致。MPS2 的单镜像 sysbuild 也通过了后三轮测试。[文件选择与恢复验证](../../tests/integration/sysbuild-file-reset.cjs)

## 复验条件

从配置好 Zephyr 源码、SDK、已安装模块和 Python 环境的开发终端，在扩展工程根目录运行：

```sh
node tests/integration/adaptive-build.cjs
node tests/integration/adaptive-sysbuild.cjs
node tests/integration/sysbuild-file-reset.cjs --dual
```

第一条命令接受场景名 `app-owned`、`empty-alias`、`stub`、`shield`、`manual`。前两条命令实际编译并链接固件，每个构建使用四个并行任务。第三条在同一目录重新配置并读取两个核的生成文件，省略 `--dual` 可运行 MPS2 单镜像样例。各命令都打印日志与产物的位置。烧录、板上运行及其余板与应用组合需另外验证。

测试机已有的 Python 环境安装了不同版本的 `python-devicetree`。x86 原生与扩展两侧均在生成页表时遇到 `_LocalProps` 缺失。复验时仅在测试进程内将当前源码中的 `scripts/dts/python-devicetree/src` 加入 `PYTHONPATH`，随后两侧成功。Windows 上此版 west 与 CMake 的 sysbuild 默认传入带反斜杠的 `APP_DIR`，可能在展开 Kconfig 目标时产生 CMake 转义错误，两条扩展入口均验证了转换为 CMake 路径后的完整构建。

**简体中文** | [English](adaptive-builds.en.md)
