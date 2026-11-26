# 开发板、架构与样例的全库识别验收

**简体中文** | [English](catalog-coverage.en.md)

## Zephyr 3.x 和 4.x 正式版

Windows Server 2022 和 Ubuntu 24.04 分别从官方标签下载源码，运行 `west boards`，再逐项核对扩展的 west 和 CMake 板卡列表。下表是两种宿主都通过的结果。目标数包括板卡修订版、SoC、CPU 集群和变体。[14 项流水线结果](https://github.com/FormingSystem/Zephyr-View/actions/runs/45754136914)

| Zephyr 版本 | 板名 | 不重复的构建目标 |
| --- | ---: | ---: |
| 3.6.0 | 666 | 666 |
| 3.7.0 | 564 | 820 |
| 3.7.2 | 564 | 823 |
| 4.2.0 | 788 | 1,216 |
| 4.3.0 | 893 | 1,393 |
| 4.4.2 | 1,014 | 1,619 |
| 4.5.0 | 1,191 | 2,014 |

3.6 使用旧硬件模型。3.7 的官方板卡接口返回列表，随后版本使用按板名索引的映射。测试读取各版本自己的命令输出。旧版 west 缺少目标字段时，使用该版本提供给 CMake 的输出比对。每个版本也检查了 Cortex-M3 目标的实际 DTS 路径。板卡枚举和固件构建分开验收。在 Windows 11 上已实际编译运行于 ARM、RISC-V、x86 目标的固件，覆盖 3.6.0、3.7.0 和 4.3.0。Windows 10 客户端需要单独验证，可在板卡流水线手动选择已注册的 Windows 10 运行器。

本地复验时，请将所选版本的 Python 依赖及 west 装入同一环境，激活后传入一份或多份源码目录。测试使用临时工作区。

```text
node tests/integration/official-board-catalog.cjs <checkout-1> <checkout-2>
```

## 4.5.0-rc1 的架构、设备树与应用

2026-11-26 在 Windows 上检查本地 Zephyr 4.5.0-rc1，源码提交为 `25c8f4a23988dd3b2cfb463613622738298c2d6c`。同一份源码分别以独立源码目录和当前 west 工作区作为发现范围，两次结果相同。以下数字描述选择器能展示哪些目标，以及配置前能知道哪些信息。实际生成固件的案例见[与原生构建的对照](adaptive-builds.md)和[上一版的多架构构建验收](multi-board-build.md)。

| 检查项 | 本次结果 | 核对依据 |
| --- | ---: | --- |
| 板名 / 不重复的 SoC 名 | 1,191 / 722 | 所选源码的 `scripts/list_boards.py` 硬件模型 |
| 声明 CPU cluster 的板 | 272 | SoC 的 `cpuclusters` 字段 |
| 可列出的完整目标 | 2,014 | 1,841 个未指定修订的目标、173 个显式修订目标，逐项核对 west 清单 |
| 可预知架构 | 1,859 | 按板、修订、SoC、CPU、变体逐项核对 Twister 的 `generate_platforms()` |
| 缺少对应 Twister 架构 | 155 | 保留目标，待实际配置读取 `CONFIG_ARCH` |
| 找到板级 DTS | 1,921 | 每个目标的绝对解析结果都与 Zephyr 的 `dts_configuration_files()` 一致 |
| 未找到标准板级 DTS | 93 | 单独运行上述官方函数且不传应用、盾板或自定义输入时，93 项均返回 `boards/common/stub.dts` |
| 命名冲突 | 0 | 同时存在长短文件名、多 SoC 使用短名等冲突另有回归用例 |

有架构声明的目标分布为 ARM 1,235、RISC-V 242、Xtensa 185、ARM64 96、ARC 42、x86 30、RX 13、POSIX 7、SPARC 3、MIPS 2、TriCore 2、Hexagon 1、OpenRISC 1。同一板的不同核与修订分别计数。west 输出 2,016 行，其中同一块板的空修订重复产生两个 `board@/soc/cpu` 拼写。Zephyr 的 `parse_board_components()` 要求 `@` 后有修订号，选择器将它们归入已列出的 `board/soc/cpu`。

板库能列出某个 CPU，并不等于这块板为它提供了可编译的固件配置。比如 `96b_meerkat96/mcimx7d/a7` 出现在 west 清单里，在这次无额外输入的设备树检查中使用了公共 stub。应用、外部模块、构建参数及自定义 CMake 仍可以提供其他输入。完整应用最终选用的路径以该次配置生成的 `build_info.yml` 为准。

### 样例应用与多文件

在 `samples/` 内按 Twister 认可的描述文件名遍历，677 个描述目录都有 `CMakeLists.txt`，在应用列表中全部可选。选择器共找到 719 个入口，另外 42 个包括多映像工程里的子应用。现可发现 `samples/modules/` 中的全部 10 个入口。自定义目录无需额外的样例描述文件，可由 `CMakeLists.txt` 中引入 Zephyr 的声明发现，或由用户指定路径。

其中 115 个带描述的应用在根目录有多个 `.conf`，18 个有多个 `.overlay`。这两个计数只含应用根目录，可选文件也可能位于 `boards/`、`socs/` 等子目录。例如 `samples/subsys/usb/shell` 没有 `prj.conf`，它的 `tests.yaml` 分别使用 `FILE_SUFFIX=device`、`host` 等参数选择对应的应用配置。发现应用无需预设唯一配置或设备树。

### 复验

在扩展项目根目录，使用已安装所选 Zephyr 分支 Python 依赖、CMake 和 Node.js 的开发终端，先设置 `ZEPHYR_BASE`。可用 `PYTHON` 指定该环境的 Python 可执行文件。第二条命令还需要该环境安装 west，且源码属于已初始化的 west 工作区。

```text
node tests/integration/catalog-coverage.cjs
node tests/integration/catalog-coverage.cjs --workspace
```

加 `--details` 可输出各个未发现标准 DTS 的目标。检查程序逐项对照实际 checkout 的硬件描述、Twister 架构和 CMake 设备树输入解析函数，用临时目录存放核对数据。构建矩阵另行验证配置、编译、链接和构建产物。

**简体中文** | [English](catalog-coverage.en.md)
