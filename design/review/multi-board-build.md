# 多架构构建与配置文件识别验收

本文记录 0.5.14 的行为。自 0.5.15 起，唯一的非标准 `.conf` 由用户确认采用，完整规则与新构建结果见[标准适配检查清单](standard-adaptation.md)。

2026-11-26，Windows x64，Zephyr SDK 1.0.1，west 1.5.0。通用目标使用 Zephyr 4.5.0-rc1。HC32F4A0PITB 使用提供该板的 4.4.99 源码和本地 `cmsis_6`、`hal_xhsc` 模块。应用、SDK 和模块均从本机读取。

### 开发板与目标架构

各行使用独立构建目录生成 `zephyr/zephyr.elf`。配置前调用扩展的设备树检测和文件选择接口，逐项比对 Zephyr 最终写入 `build_info.yml` 的路径与次序。配置后用扩展重新读取该构建目录，核对板级默认配置、应用配置与覆盖文件。最后检查 ELF 文件头的目标架构。

| 开发板 / SoC / CPU | 入口 | 宿主并行任务数 | 自动选中的设备树 | ELF 架构 |
| --- | --- | --- | --- | --- |
| `uyup_rpi_a/hc32f4a0pitb` | CMake | 1 | `uyup_rpi_a_hc32f4a0pitb.dts` | ARM |
| `mps2/an386` | CMake | 自动 32 | `mps2_an386.dts` | ARM |
| `nrf5340dk/nrf5340/cpuapp` | west | 自动 32 | `nrf5340dk_nrf5340_cpuapp.dts` | ARM |
| `nrf5340dk/nrf5340/cpunet` | CMake | 4 | `nrf5340dk_nrf5340_cpunet.dts` | ARM |
| `qemu_x86/atom` | west | 2 | `qemu_x86.dts` | Intel 80386 |
| `qemu_riscv32/qemu_virt_riscv32/smp` | CMake | 3 | `qemu_riscv32_qemu_virt_riscv32_smp.dts` | RISC-V |

以上六个目标均使用板级 `*_defconfig` 加应用的 `prj.conf`。两条构建入口都用扩展实际生成的并行参数，从清理后的目录重编。本机报告 32 个可用逻辑处理器。RISC-V 工程的 `.config` 同时显示 `CONFIG_SMP=y` 和 `CONFIG_MP_MAX_NUM_CPUS=2`；此次宿主启动 3 个编译任务。nRF5340 的两个 CPU 分别编译为独立映像。本轮验证到编译和链接，未烧录硬件。

### 应用中同时存在多个文件

另外两组 Intel Atom 构建使用隔离的应用副本。每组同时检查 Zephyr 记录的输入，以及 `.config` 和 `zephyr.dts` 的最终值。

| 操作 | 实际合并的输入 | 核对结果 |
| --- | --- | --- |
| 自动配置，候选目录还含 `operator.conf`、根 `app.overlay` | `prj.conf` → `socs/atom.conf` → `boards/qemu_x86_atom.conf`；`socs/atom.overlay` → `boards/qemu_x86_atom.overlay` | west 生成 Intel ELF，栈大小 3584，设备树 model 为 `board-default` |
| 从扩展接口选中两个配置片段和一个覆盖文件 | `first.conf` → `last.conf`；`explicit.overlay` | CMake 生成 Intel ELF，栈大小 3072，设备树 model 为 `matrix-picked` |

### x86 的 Python 依赖复验

同一个 Python 模块在本机有两个来源。Zephyr 的 `scripts/dts/gen_edt.py` 把当前源码的 `scripts/dts/python-devicetree/src` 放在搜索路径首位，写出 `edt.pickle`。x86 的 `arch/x86/gen_mmu.py` 把源码路径追加在末尾，读回文件时先找到了本机虚拟环境中 `dtsh 0.2.5` 分发的 `devicetree/edtlib.py`。这份副本缺少 `_LocalProps`，导致生成 x86 页表失败。Zephyr 自带的设备树包在 `scripts/dts/python-devicetree/setup.py` 声明依赖 `PyYAML>=6.0`。

复验使用独立的 Python 3.12 虚拟环境，复用其余已装依赖，在新环境的 site-packages 中离线安装当前源码的 `devicetree 0.0.2`，确认实际导入文件来自新环境。移除测试进程的 `PYTHONPATH` 后，CMake 与 west 分别从空构建目录配置 `qemu_x86/atom`。两次均使用新环境解释器，生成页表并链接出 Intel 80386 ELF。

遇到同一冲突时，可在专用的 Zephyr 开发虚拟环境里，从匹配的 Zephyr 源码根目录执行下列命令。离线安装需预装 setuptools 和 PyYAML。

```sh
python -m pip install --no-index --no-build-isolation --no-deps ./scripts/dts/python-devicetree
python -c "from devicetree import edtlib; print(edtlib.__file__)"
```

### 在本地重复验证

Windows VS Code 的正式版 VSIX 也通过了界面操作验证。在「应用配置」输入 `dmcp` 可找到 `demo-copy.conf`，已有的勾选仍保留。使用 Windows 文件选择器选择同一文件后，再恢复工程设置，原 `prj.conf` 和可构建状态均恢复。工程配置图的应用配置节点提供相同的操作。并行任务数从自动 32 切换为自定义 3 时，CMake 命令预览同步显示 `--parallel 3`。[构建页实机截图（1920 × 1080）](installed/configuration-inputs-0.5.14.png)

在 Zephyr 源码根目录用一个新的构建目录复查目标。以下两例分别使用 SDK 的 x86 和 RISC-V 工具链。将板名换为表中其他目标时也更换构建目录。HC32 需从包含 `uyup_rpi_a` 的源码构建，并让 west 清单或 CMake 的 `ZEPHYR_MODULES` 提供该板依赖的模块。

```sh
west build --cmake-only -b qemu_x86/atom -d build/matrix-x86 samples/hello_world
west build -d build/matrix-x86 -o=-j2
cmake -S samples/hello_world -B build/matrix-riscv -G Ninja -DBOARD=qemu_riscv32/qemu_virt_riscv32/smp
cmake --build build/matrix-riscv --parallel 3
```

在能编译 Zephyr 的开发终端运行，`ZEPHYR_BASE` 指向要测试的源码，Python 环境、SDK、Ninja 和所需模块均应可用。以下脚本位于独立扩展工程，以系统临时目录保存应用、构建日志所指向的产物和配置记录。每轮检查输入文件字节、有效栈大小与 ELF，并打印用于复查的目录。

```sh
node tests/integration/build-file-selection.cjs mps2/an386
```

实测 `mps2/an386` 在同一构建目录依次得到 1536（默认）、3072（`first.conf;last.conf`）、2048（颠倒顺序）、1536（恢复默认）。随后指定替代主设备树和覆盖文件，最终硬件型号变成 `selected-overlay`。恢复自动选择后，设备树输入重新指向 `mps2_an386.dts`，型号恢复原值。另一个只有 `application.conf` 的应用自动编译出 2304 的栈。七次均检查了 `build_info.yml` 中的实际输入顺序、最终 `.config`、ELF 和源文件内容。更换命令末尾的板目标，可用本机已安装的其他工具链重复验证。[验证脚本](../../tests/integration/build-file-selection.cjs)
