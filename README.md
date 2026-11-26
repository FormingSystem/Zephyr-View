# Zephyr View

**简体中文** | [English](README.en.md)

在 VS Code 中配置、构建和调试 Zephyr 应用。支持 west 工作区和独立 CMake 工程，可使用已有源码、模块、SDK 与离线安装包。

[下载当前预发布版 VSIX](https://github.com/FormingSystem/Zephyr-View/releases) · [使用手册](extension/README.md) · [Apache-2.0](LICENSE) · [第三方声明](extension/ThirdPartyNotices.txt)

在发布页展开 **Assets**，下载 `.vsix` 文件，然后在 VS Code 的「扩展 → … → 从 VSIX 安装…」中选择它。

首次使用可从[入门指南](extension/GETTING_STARTED.md)开始。随包提供操作动图、可编译的应用和本地模块，以及一套树外板与 SoC 示例。

在 VS Code 活动栏打开 **Zephyr View**。默认进入工作区。导航依次为构建、工作区、工程配置、模块和线程。在工作区查看构建进程使用的环境变量；在构建页核对配置输入和 CMake 上次记录的值。工作台支持 west 和 CMake。选板后可以在同一行组查看识别到的 DTS。在「工程配置」展开当前应用的配置图，双击软件符号或实际硬件节点，在节点旁修改。支持空白处拖动、Ctrl + 滚轮缩放、另存副本和写回应用配置。

在「工作区 → 环境搭建 → 探针与驱动」逐项查看本机工具路径和已连接的设备，选择已有工具目录，或从该行部署工具与驱动。

在「构建」选好开发板和 CPU 后，可以直接使用推荐的 SDK 编译器，也可为当前应用和板选用其他本机工具链。配置完成后可在同一处核对 `CMAKE_C_COMPILER`。

- [配置图实机演示 · 1920×1080](extension/media/guide/configuration-map.gif)
- [跨架构构建验收与复现步骤](design/review/adaptive-builds.md) · [0.5.15 构建页实机截图](design/review/installed/adaptive-board-0.5.15.png)
- [设计及逐项评审](design/review/README.md)
- [打开交互设计稿](design/index.html#workspace)
- [Zephyr 标准适配清单](design/review/standard-adaptation.md) · [全库识别结果](design/review/catalog-coverage.md) · [原生构建对照](design/review/adaptive-builds.md)
- [跨平台安装与验证记录](design/review/platform-support.md)
- [组件安装、固件烧写和工作台全量评审](design/review/installation-and-flashing.md)
- [逐模块评审和验收条件](design/review/module-refinement.md)

在「线程」页可以生成消息队列、信号量或互斥量的双线程工程，分析当前应用的调用关系，也可以在断点处核对栈帧与变量。示例工程可用 west 或 CMake 构建。[线程入门](extension/guides/threads.md) · [详细设计与验证](design/review/thread-studio.md) · [离线交互稿](design/review/thread-studio-preview.html)

## 商业使用与许可

Zephyr View 与 Zephyr RTOS 的项目主许可证均为 Apache-2.0。你可以在商业产品中使用、修改和分发本项目的原创代码、文档和设计资源。再分发时须随附许可证，保留适用的版权和归属声明，并在修改过的文件中注明改动。随包分发的第三方组件按各自的许可证使用。[许可全文](LICENSE) · [第三方声明](extension/ThirdPartyNotices.txt)

**简体中文** | [English](README.en.md)
