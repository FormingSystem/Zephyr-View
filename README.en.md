# Zephyr Extension

[简体中文](README.md) | **English**

Configure, build and debug Zephyr applications in VS Code. Use a west workspace or a standalone CMake project with existing sources, modules, SDKs and offline installers.

[Download the latest VSIX](https://github.com/FormingSystem/zephyr-extension/releases/latest) · [User guide](extension/README.en.md) · [Apache-2.0](LICENSE) · [Third-party notices](extension/ThirdPartyNotices.txt)

Download the `.vsix` file from the release. In the VS Code Extensions view, choose **… → Install from VSIX…** and select the file.

Open **Zephyr Extension** in the Activity Bar. The workbench opens on **Workspace**. Its tabs are **Build**, **Workspace**, **Project configuration** and **Modules**. Workspace shows the environment available to the build process. Build shows the inputs for the next configure alongside the last values recorded by CMake. Select a board to see the detected board DTS. In Project configuration, expand the application's graph and double-click a Kconfig symbol or hardware node to edit it in place. Drag the canvas to pan, use Ctrl + wheel to zoom, then save a copy or write the reviewed changes to the application configuration.

After selecting a board and CPU on **Build**, use the recommended SDK compiler or choose another local toolchain for this application and board. After configuring, check `CMAKE_C_COMPILER` in the same view.

- [Configuration graph walkthrough in VS Code · 1920×1080](extension/media/guide/configuration-map.gif)
- [Cross-architecture builds and reproduction steps](design/review/adaptive-builds.en.md) · [Build view in 0.5.15](design/review/installed/adaptive-board-0.5.15.png)
- [Design reviews and acceptance criteria](design/review/README.en.md)
- [Interactive workbench prototype (Chinese interface)](design/index.html#workspace)
- [Zephyr standards coverage](design/review/standard-adaptation.en.md) · [Catalog scan results](design/review/catalog-coverage.en.md) · [Native build comparison](design/review/adaptive-builds.en.md)
- [Cross-platform installation and verification](design/review/platform-support.en.md)
- [Component installation, firmware flashing and workbench review](design/review/installation-and-flashing.en.md)
- [Review and acceptance criteria by module](design/review/module-refinement.en.md)

The installed workbench reads your active project and environment. The design prototypes use sample data. To try them, download the repository and open the HTML file in a browser. The proposed function and thread views are currently under design review. [Design review](design/review/thread-analysis.en.md) · [Interactive two-thread example](design/review/thread-analysis-preview.html?lang=en)

[简体中文](README.md) | **English**
