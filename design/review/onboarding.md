# 入门流程评审

**简体中文** | [English](onboarding.en.md)

用同一个应用走完「准备工具、选板、接入库、改变固件输出」。检验标准是初学者能找到拥有这项配置的页面，并能用 Zephyr 生成的文件核对界面上的结果。[按步骤操作](../../extension/GETTING_STARTED.md)

## 谁负责哪一项配置

| 用户要做什么 | 可操作的入口 | 核对结果 |
| --- | --- | --- |
| 准备本机工具或打开 west 工作区 | 工作区的「环境搭建」管理 Python、SDK 和共用工具链；「west 工作区」在同页提供打开、初始化、查看清单及修复清单位置。 | 核对进程变量的取值来源，以及 `.west/config` 指向的清单。独立 CMake 应用可以跳过 west 初始化。[工作区指南](../../extension/guides/west-workspace.md) |
| 指定一个应用、板、编译器和并行度 | 构建页选择 west 或 CMake、应用和板，在「目标编译器」查看实际可执行文件或覆盖该目标的选择。 | 配置后读取 `CMakeCache.txt` 的 `CMAKE_C_COMPILER`。改用另一个构建目录可对照两种工具链。[工具链练习](../../extension/guides/cmake-integration.md) |
| 接入本地库或板包 | 在模块页选择目录并勾选模块。板包由 `zephyr/module.yml` 声明硬件搜索根；用户随后可以在构建页正常选板。 | 在生成的 `zephyr_modules.txt` 找到模块。在目标列表搜索教学板 `view_lab/view_m3`，配置后查看 `zephyr/zephyr.dts`。[板包练习](../../extension/guides/hardware-port.md) |
| 更改软件开关或设备树属性 | 在工程配置图搜索符号或展开硬件节点，查看差异，另存配置片段或写回选中的工程文件。 | 重新配置后在 `zephyr/.config` 或 `zephyr/zephyr.dts` 核对生效值。仅另存的片段要加入构建才会生效。 |
| 取得可改动的示例 | 从活动栏或命令面板打开入门指南。运行「复制入门示例…」，选择可写目录，在新窗口打开副本。 | 示例应用、模块和硬件包可独立修改。重复选择已有副本的目录时，命令提示另选位置。 |

## 走查中修复的问题

- **目标编译器有两个编辑入口。** 原先工作区和构建页都显示当前应用与板的可写选择器。现在由构建页管理目标覆盖。工作区保留共享 SDK、`ZEPHYR_TOOLCHAIN_VARIANT` 和外部 GNU 前缀。首次将工作区变体选为 `cross-compile` 时，即便前缀为空，也能选择 GCC 或输入前缀。切回 SDK 时，之前构建的前缀仍可查阅。
- **窄编辑器把编译器操作裁掉。** 在 320 像素宽的英文编辑区，长路径撑宽了网格列，导致下拉框和外部工具链操作右侧约 34 像素无法使用。网格列现可缩到容器宽度，控件保持在可见范围。
- **增选本地模块后可能丢失原有依赖。** 从 west 工作区之外打开示例应用，使用带 west 的构建 Python 和 west 管理的 Zephyr 源码时，勾选 greeting 曾替换原模块列表，导致 CMSIS 缺失。这条路径现在把新模块传给 `EXTRA_ZEPHYR_MODULES`。完全离线、无默认模块集合时，通过 `ZEPHYR_MODULES` 提供目标所需的完整本地集合。

## 怎样复核

1. **页面与可达性。** 用实际扩展的 Webview HTML、脚本、样式和一次已配置 Cortex-M4 工程的宿主数据，在 Chromium 中回放四个页面。加入超过 190 个字符的路径、多候选应用、清单 revision 和 16 个教学模块，展开设置项。中英文各检查 1280、720、480、360、320 像素五种可用宽度。40 组检查中页面均无横向溢出，导航与普通表单控件可在滚动后点击，配置图保留自己的平移区域。另在两种语言中确认工作区只有全局工具链字段，构建页只有一套目标选择器。
2. **实际固件。** Windows 上用 Zephyr 4.5.0-rc1 的 `mps2/an386` 运行三次构建。west 搭配 SDK GCC 14.3.0 启用 greeting；不含 west 的 Python 配合 CMake 和同一 SDK 关闭 greeting；同一离线 Python 配合 CMake 和外部 GNU Arm GCC 10.3.1 启用 greeting。检查编译器缓存、Kconfig、源文件编译清单和 QEMU 串口。两次启用都打印 `Hello from the local module`，关闭时打印 `Application only`。另外启用 `CONFIG_DEBUG_OPTIMIZATIONS` 后，实际编译命令出现 `-Og`。
3. **验证范围。** 宽度走查复用了宿主数据并在浏览器渲染，未在每个尺寸逐次启动 VS Code 或操作系统文件选择器。上述固件用 QEMU 验证，物理探针、实板烧录和 macOS、Linux 界面仍需分别实测。

**简体中文** | [English](onboarding.en.md)
