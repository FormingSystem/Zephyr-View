# Zephyr View

**简体中文** | [English](README.en.md)

在 VS Code 中配置、构建和调试 Zephyr 应用。支持 west 工作区和独立 CMake 工程，可使用已有源码、模块、SDK 与离线安装包。

[下载最新 VSIX 安装包](https://github.com/FormingSystem/zephyr-extension/releases/latest) · [使用手册](extension/README.md) · [Apache-2.0](LICENSE) · [第三方声明](extension/ThirdPartyNotices.txt)

下载发行版中的 `.vsix` 文件，在 VS Code 的「扩展 → … → 从 VSIX 安装…」中选择它。

在 VS Code 活动栏打开 **Zephyr View**。默认进入工作区。导航依次为构建、工作区、工程配置和模块。在工作区查看构建进程使用的环境变量；在构建页核对配置输入和 CMake 上次记录的值。工作台支持 west 和 CMake。选板后可以在同一行组查看识别到的 DTS。在「工程配置」展开当前应用的配置图，双击软件符号或实际硬件节点，在节点旁修改。支持空白处拖动、Ctrl + 滚轮缩放、另存副本和写回应用配置。

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

工作台读取当前工程和环境。交互设计稿使用示例数据；可将仓库下载到本地，在浏览器中打开对应的 HTML 文件。函数调用与线程视图目前处于设计评审阶段。[设计说明](design/review/thread-analysis.md) · [双线程交互样例](design/review/thread-analysis-preview.html)

**简体中文** | [English](README.en.md)
