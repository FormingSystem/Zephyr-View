# 从安装工具到烧写固件：工作台全量评审

**简体中文** | [English](installation-and-flashing.en.md)

基线是独立扩展的 `v0.5.15`（`4f0d558`）。评审检查了正式扩展的四个页面、活动栏与调试侧栏、宿主命令、文件与任务的实际调用，以及浏览器设计稿。下表记录基线缺口；已交付项与尚待实机验证的项目分别在文末登记。

| 页面 / 模块 | 0.5.15 可以做什么 | 需要优化的操作及归属 |
| --- | --- | --- |
| 工作区 · 主机工具、Python、SDK | 能发现或指定已有工具、SDK 和编译器。浏览器稿里能模拟安装，扩展宿主没有安装流程 | **A 安装**。每个工具旁给出官方发布页、当前平台支持的安装动作、使用已有文件入口。SDK 分开选择兼容版本、宿主平台与目标架构，区分缓存目录与安装目录 |
| 工作区 · 环境变量 | 可继承环境、查看缓存，扩展覆盖只作用于工作区任务 | **B 作用范围**。默认工作区；确有共享需求时选当前用户或系统级。明确原值、将写入的值、对哪些新进程生效。SDK 的 CMake 包注册与环境变量分别处理 |
| 工作区 · 探针支持 | “烧录与调试”目前只重复显示侧栏的默认调试器 | **C 探针与驱动**。此处处理主机工具、设备接口及访问权限。就地打开官方驱动或权限规则，安装程序支持的场景可本机调用，完成后重新检测 |
| 构建 · 目标、产物及烧写 | 有配置、构建、Kconfig、启动调试；已有目标和构建域信息，缺少烧写按钮 | **D 烧写**。在构建页选烧写方式、设备和镜像，预览产物，从这里启动任务。支持从 CMake 和 west 生成的构建目录读取证据 |
| 工程配置 · 图、检查器、独立窗口 | 图支持定位、草稿和选择模块；每个模块节点都有相同的“管理模块”跳转 | **E 图的职责**。单个节点就地选择或查看工程配置。完整仓库管理在父节点保留一个入口。检查器随当前选择工作；保留 Kconfig、设备树与草稿的独立保存语义 |
| 模块 · 来源、清单、搜索及批量同步 | 有四类来源、分页和同步预览。导入清单在图与列表的读取路径不同，批量失败时关闭预览 | **F 模块数据与反馈**。图、模块页采用同一有效清单。回退时标出范围；同步保留每项结果及可重试项，失败后留在原处 |
| 活动栏、调试侧栏、原生窗口 | 可跟随调试会话，标题栏按钮显隐受 VS Code 控制 | **G 侧栏**。保留调试会话、运行器与产物的可点击行，补上常驻刷新。烧写只在构建目标区负责，调试配置继续交给 VS Code |
| 所有页面 · 信息密度及边界 | 顶栏四个页面；页面共享应用、构建目录、回读结果 | 使用一列、自适应宽度。在当前位置展开必要选项。通用操作复用提供者或任务接口；页面只共享工程事实，避免把“转到另一个页面”当作必经步骤 |

源码证据：[工作区环境视图](../../extension/media/setupViews.js) · [构建操作](../../extension/media/build_page.js) · [图节点](../../extension/media/studioMap.js) · [模块操作](../../extension/media/nativeModules.js) · [目标与运行器](../../extension/target.js) · [调试侧栏](../../extension/extension.js) · [宿主与页面连接](../../extension/workbench.js)

## 两条使用路径

1. **新电脑**。打开工作区 → 发现已有组件 → 在缺项行选“安装”“官方下载”或已有本地包 → 核对目标版本、目录和作用范围 → 安装并重检。发布方要求许可、登录或只提供交互安装器时打开其官方分发入口。包管理器或驱动仅支持系统位置时明确显示，不展示无效的目录选择器。SDK 安装和项目构建可分别选用 west 或本地工具；离线输入须匹配宿主和目标。[Zephyr 安装指南](https://docs.zephyrproject.org/latest/develop/getting_started/index.html) · [SDK 安装与注册](https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html) · [SDK 官方发布包](https://github.com/zephyrproject-rtos/sdk-ng/releases)
2. **接上板**。构建页读取当前生成目录 → 选择固件对应的域或整个系统 → 使用板的默认烧写运行器或选择其他支持的运行器 → 必要时选择探针序列号或串口 → 核对产物并烧写。多域按 `domains.yaml` 的 `flash_order` 执行。本机 nRF5340 样例的主域是 `hello_world`，实际烧写顺序为 `remote`、`hello_world`。构建用 CMake 时，已有的 west 仍可用于烧写；缺 west 时给出已经验证的原生方式、工程任务或产物入口。全片擦除与普通下载属于不同操作。[Zephyr 烧写与运行器](https://docs.zephyrproject.org/latest/develop/west/build-flash-debug.html#flashing-west-flash) · [官方主机工具索引](https://docs.zephyrproject.org/latest/develop/flash_debug/host-tools.html)

## 设备和系统集成

| 检测到的情况 | 界面应提供的下一步 |
| --- | --- |
| SDK 已安装或使用自定义目录 | 核对版本和编译器，允许复用；分别说明 `ZEPHYR_SDK_INSTALL_DIR`、SDK 的 CMake 包注册、Zephyr 源码的 `west zephyr-export` 各自影响什么。[CMake 包注册](https://docs.zephyrproject.org/latest/build/zephyr_cmake_package.html) |
| CMSIS-DAP | 区分探针接口、pyOCD 程序、芯片支持包。v1 常走 HID，v2 常走 WinUSB；Linux 可根据实际访问错误引导配置 udev。[pyOCD 探针](https://pyocd.io/docs/debug_probes.html) · [安装和权限](https://pyocd.io/docs/installing.html) |
| ST-LINK、J-Link | 分别给出 ST 与 SEGGER 的官方工具和驱动。已可访问的设备直接复用；多个探针按序列号区分。[ST-LINK Windows 驱动](https://www.st.com/en/development-tools/stsw-link009.html) · [J-Link 软件包](https://www.segger.com/downloads/jlink/) |
| DFU、串口、模拟器 | DFU 查模式、设备和接口；串口存在只说明通信接口可见，需核对目标 bootloader。模拟板优先展示可用的仿真动作。USB 未枚举、正被占用和访问被拒绝分别报告。[dfu-util](https://dfu-util.sourceforge.net/dfu-util.1.html) |
| 当前用户、系统或远程宿主 | 展示实际执行所在的主机；持久变量在新进程中复核。Windows 分开读写 User/Machine；Linux 明示设置适用的登录会话。驱动安装采用系统授权机制，并给出取消后的恢复入口。[Windows 环境变量作用域](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables) · [Linux 用户会话环境](https://www.freedesktop.org/software/systemd/man/latest/environment.d.html) |

## 验收

- 安装：已有 SDK、空目录、本地包、缺架构组件、厂商网页分发、取消安装、工具由系统管理位置。只有查询到实际版本或可执行文件后才显示已就绪。
- 烧写：单板多运行器、双域与不同默认顺序、仅调试运行器、没有烧写器、CMake 无 west、多个序列号、用户取消。区分生成命令的测试和实板写入结果。
- 各页面：用同一应用及同一板切换四页，同时测试多根工作区、窄窗口、中英文、键盘操作、淡色及深色。选项切换后原工程数据与未采用的选择均可追踪。
- 模块：带 import 的清单在图与模块页一致；两项同步第二项失败时可看到第一项已完成并只重试余项。调试侧栏在关闭“总是显示标题栏操作”时也能刷新。

## 0.5.16 交付与实测

| 模块 | 交付和验证结果 |
| --- | --- |
| 主机工具与 SDK | 在工作区同一工具行选择本机安装、已有文件或官方来源。离线 SDK 测试使用带 SHA-256 清单的小型归档，覆盖校验、安装失败和在同一目录重试。离线 Python 测试从本地 wheel 安装到独立虚拟环境。 |
| 环境变量与探针 | 工作区保留工程值。注册到用户或系统时可挑选变量、预览旧值。Windows 实际查询了当前用户环境及即插即用设备；本机没有匹配的 CMSIS-DAP，界面提供重新检测、驱动说明和官方入口。 |
| 构建与烧写 | 在没有 west 的环境中通过 CMake 编译 ARM 示例并生成 ELF。读取 nRF5340 双核构建产物，整机预览顺序为网络核 `remote`、应用核 `hello_world`。在 `mps2/an386` 的原生界面验证了默认探针和指定设备 ID 两种预览。[离线构建用例](../../tests/integration/no-west-build.cjs) · [多域烧写预览](../../tests/integration/flash-preview.cjs) |
| 工程配置、模块与侧栏 | 图的叶节点可就地选择模块，片段检查器随选择更新，侧栏保留常驻刷新行。实际工作区解析出 69 个模块；独立离线样例读到导入清单内的固定版本。两项同步的回归用例验证第一项成功、第二项失败后，仅重试未完成项。 |
| 界面 | 从 VSIX 安装后在 Windows VS Code 打开中英文工作台。窄至 506 CSS 像素时，四个页面均可点击切换，无整页横向溢出。此次实测发现并修正了 Sysbuild 复选框导致烧写面板停在加载状态的问题，重装后面板可显示镜像和命令。英文 Dark Modern 主题下，烧写面板所测文本最低对比度为 4.53∶1，Tab 可从设备 ID 移至扫描按钮，也可从烧写按钮移至工程任务。 |

本轮运行了 145 个 JavaScript 测试，全部通过。Windows 上的 13 个 Python 测试中，11 个通过，2 个按平台跳过。Linux 桌面和系统级安装、厂商驱动安装、官方完整 SDK 的全量下载，以及连接探针后写入实板，仍需相应环境验收。当前对双核烧写的验证止于读取实际产物与生成命令。

以下截图来自已安装的 VS Code 扩展，原图均为 1920 × 1080。[主机工具安装选项](installed/install-options-0.5.16.png) · [探针检测与官方驱动](installed/probe-diagnostics-0.5.16.png) · [中文烧写预览](installed/firmware-flashing-0.5.16.png) · [英文深色主题与键盘焦点](installed/firmware-keyboard-dark-0.5.16.png)

安装后可按中英文手册复核同一流程。[使用手册](../../extension/README.md) · 验收版本 0.5.16

**简体中文** | [English](installation-and-flashing.en.md)
