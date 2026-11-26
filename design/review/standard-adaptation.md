# Zephyr 自适配检查清单

本次以 Zephyr 4.5.0-rc1 的源码、板库和官方样例为基准。验收分三步：选择器能否发现目标，构建命令是否保留工程和用户的选择，产物是否反映这些选择。每次更新 Zephyr 或调整识别规则，都可以分别复验这三步。

| 标准输入或行为 | 查出的缺口 | 0.5.15 的处理与复验 |
| --- | --- | --- |
| 应用入口及模块中的样例 | 搜索会跳过路径名为 `modules` 的样例，也容易漏掉只有 CMake 入口的子应用 | 在选定源码目录和工作区扫描样例描述与 CMake 入口，排除实际构建产物。677 个官方样例全部出现，另找到 42 个应用入口 |
| `BOARD[@revision][/qualifiers]`、别名及工程默认值 | 未列入目录的目标无法选择，也会强制要求工程在配置前给出板名 | 默认沿用工程。可在行内搜索和选板，也可明确采用输入的别名。工作台保留参数、环境和缓存的来源，配置后读取 Zephyr 解析的目标 |
| `BOARD_ROOT`、`SOC_ROOT`、`ARCH_ROOT` 与多核板 | 扩展根目录、板的修订和 CPU 变体可能漏识别，编译器推荐曾漏读 Twister 板元数据 | 合并工程和环境的根目录。按修订及变体检查架构，配置后使用 `CONFIG_ARCH`。缺少元数据的 155 个目标仍可选择 |
| 模块提供的树外板 | 在 west 下单独运行 `west boards` 会漏掉只通过工程参数加入的模块，也可能多列显式模块集之外的板 | 从所选源码读取模块的 `build.settings.board_root`。实测追加模块、旧版变量名、界面勾选和显式替换整个模块集；选择器分别展示加入的板，或仅展示指定模块提供的板和 Zephyr 内置板。[树外板列表复验](../../tests/integration/module-board-selection.cjs) |
| `CONF_FILE`、`APPLICATION_CONFIG_DIR`、`FILE_SUFFIX` | 目录内唯一的非标准 `.conf` 可能盖过工程声明，空值或相对路径曾丢失 | 标准文件按工程规则展示，孤立文件作为可采用的建议。保留显式空列表，按工程配置目录回读实际输入。工程外的文件也可按序手选 |
| `DTS_SOURCE`、`DTC_OVERLAY_FILE`、shield 及额外片段 | 找不到板级 DTS 或有多个候选时会阻止配置，提前扫描无法知道 shield 最终带入的文件 | 交给当前 Zephyr 配置，支持手选基础 DTS 和多个 overlay。从生成的 `build_info.yml` 核对合并结果。全库 93 个目标在无额外输入时由官方函数选用公共 `stub.dts` |
| 手选、变更、撤销 | 界面选项和 CMake 缓存可能不同步，尤其是第一次由工程决定板名、之后才知道实际目标 | 按应用、构建目录和选板方式保存选择。手选后可调整顺序或恢复工程设置。x86 在同一构建目录恢复了原栈大小和设备型号 |
| sysbuild 与多个构建域 | 工作台曾把顶层模板当作应用，构建根目录也没有各 CPU 的 `.config` 和 `zephyr.dts` | 构建和重新配置作用于根目录，默认域提供应用配置与硬件证据。west 和 CMake 两个入口均实际构建了 nRF5340 的应用核及网络核 |
| sysbuild 主镜像恢复工程设置 | 顶层已清除手选文件时，主镜像的子缓存仍可能沿用旧值 | 只撤销本工具在该镜像中留下的文件选择。实测恢复后，工程 Kconfig 栈大小由 1536 变为 2048，再改工程默认值后变为 2816；设备树 `model` 也依次反映三次输入。[同一构建目录的恢复验证](../../tests/integration/sysbuild-file-reset.cjs) |
| 并行编译 | 只限制顶层任务时，由 sysbuild 启动的子构建可能使用不同的并发数 | 工作台显示宿主机可用的逻辑处理器数，支持继承 `CMAKE_BUILD_PARALLEL_LEVEL` 或手选任务数。对 sysbuild 的子进程也传递该值。这里的核数指运行编译器的电脑，与开发板上的 CPU 数量分别设置。[并行设置回归](../../tests/buildParallelism.test.js) |
| 独立 CMake 工程及本机模块 | 在已安装 west 的环境里通过 CMake 构建，仍无法判断扩展是否暗中依赖 west | 在缺少 west 命令和 Python 包的环境，用本机 SDK 和显式 `cmsis_6` 链接 ARM 固件。已核对生成缓存和实际模块列表。[无 west 构建验证](../../tests/integration/no-west-build.cjs) |

[全库目录与复验命令](catalog-coverage.md) · [实际构建、文件顺序及结果对照](adaptive-builds.md) · [使用手册](../../extension/README.md)

## 正式安装包界面验收

123 项 JavaScript 回归和 5 项 Python 回归全部通过。本机 VS Code 扩展列表已核对为 0.5.15。

Windows 中文版 VS Code 1.147.0 在独立用户配置中安装了 0.5.15 VSIX。通过活动栏进入构建页，搜索工程定义的板别名 `lab_controller`，点击「使用此 BOARD」后，CMake 命令预览出现该目标。点击「使用工程设置」后，预览移除显式 `BOARD`。同一应用中的 `bringup.conf` 先显示为候选，从列表勾选后进入 `CONF_FILE`，恢复后该参数也从命令中移除。[1920 × 1080 实机截图](installed/adaptive-board-0.5.15.png)

切换到官方 `samples/sysbuild/hello_world` 及其 nRF5340 构建目录后，构建页显示已启用 Sysbuild，并列出 `hello_world`（主镜像）和 `remote`。切换到工作区、再返回构建页，镜像列表与勾选状态均正确。

## 如何判定通过

1. 记录所选 Zephyr 版本与源码提交。用同一份源码分别通过 west 工作区和独立 CMake 源码目录生成候选，再与该版本的硬件模型、Twister 数据及 CMake 的解析结果对照。
2. 用工程原有命令在干净目录构建，再由工作台在另一个目录构建。比较 `build_info.yml` 的板、限定符、Kconfig 文件和设备树输入，并检查 `.config`、合并后的设备树与实际 ELF 架构。
3. 在同一工作台构建目录内手选多份文件、恢复工程设置并重新构建。检查文件次序、最终值及原工程文件。多镜像工程还要检查每个域自己的目标及 ELF。

本轮静态核对覆盖该源码的全部 2,014 个板目标。实际编译、链接覆盖验收报告列出的代表工程。其余板与应用组合、硬件外设行为、实板烧录以及不同发行版须分别验证。含动态 CMake、外部模块和自定义硬件描述的工程，在生成构建记录前可显示待确认；保留此状态能避免把猜测写回工程。

官方参考：[板、修订与限定目标](https://docs.zephyrproject.org/latest/hardware/porting/board_porting.html) · [Kconfig 应用配置](https://docs.zephyrproject.org/latest/build/kconfig/setting.html) · [设备树与 overlay](https://docs.zephyrproject.org/latest/build/dts/howtos.html) · [sysbuild 及各镜像的命名空间](https://docs.zephyrproject.org/latest/build/sysbuild/index.html)
