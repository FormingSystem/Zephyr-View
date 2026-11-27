# Zephyr View

[简体中文](README.md) | **English**

Open **Programming Studio** from the Zephyr View sidebar. In its separate window, design architecture, control flow and signal pipelines on the left and follow the selected node in C on the right. Switch to **Project source** to explore calls and type members in hand-written code or set a breakpoint on a selected line. Use **UML classes** to distinguish value members, references and explicit inheritance, follow an edge to its member declaration, open a target type in a directly included header, or export to PlantUML. Choose **UML modeling…** to create editable project diagrams from 14 templates. [Walkthrough and 1080p animation](extension/guides/visual-program.en.md)

Configure, build and debug Zephyr applications in VS Code. Use a west workspace or a standalone CMake project with existing sources, modules, SDKs and offline installers.

[Download the current preview VSIX](https://github.com/FormingSystem/Zephyr-View/releases) · [User guide](extension/README.en.md) · [Apache-2.0](LICENSE) · [Third-party notices](extension/ThirdPartyNotices.txt)

Expand **Assets** on the release page and download the `.vsix` file. In the VS Code Extensions view, choose **… → Install from VSIX…** and select the file.

Start with [Getting started](extension/GETTING_STARTED.en.md) for step-by-step animations, a buildable application and local module, and an out-of-tree board and SoC example.

Open **Zephyr View** in the Activity Bar. The workbench opens on **Workspace**. Its tabs are **Build**, **Workspace**, **Project configuration**, **Modules** and **Programming Studio**. Workspace shows the environment available to the build process. Build shows the inputs for the next configure alongside the last values recorded by CMake. Select a board to see the detected board DTS. In Project configuration, expand the application's graph and double-click a Kconfig symbol or hardware node to edit it in place. Drag the canvas to pan, use Ctrl + wheel to zoom, then save a copy or write the reviewed changes to the application configuration.

Open **Workspace → Environment setup → Probes and drivers** to see local tool paths and connected devices. Select an existing tool folder or deploy the tool and its supported drivers from the same row.

After selecting a board and CPU on **Build**, use the recommended SDK compiler or choose another local toolchain for this application and board. After configuring, check `CMAKE_C_COMPILER` in the same view.

- [Configuration graph walkthrough in VS Code · 1920×1080](extension/media/guide/configuration-map.gif)
- [Cross-architecture builds and reproduction steps](design/review/adaptive-builds.en.md) · [Build view in 0.5.15](design/review/installed/adaptive-board-0.5.15.png)
- [Design reviews and acceptance criteria](design/review/README.en.md)
- [Interactive workbench prototype (Chinese interface)](design/index.html#workspace)
- [Zephyr standards coverage](design/review/standard-adaptation.en.md) · [Catalog scan results](design/review/catalog-coverage.en.md) · [Native build comparison](design/review/adaptive-builds.en.md)
- [Cross-platform installation and verification](design/review/platform-support.en.md)
- [Component installation, firmware flashing and workbench review](design/review/installation-and-flashing.en.md)
- [Review and acceptance criteria by module](design/review/module-refinement.en.md)

In **Programming Studio → Tools → Analyze project concurrency**, generate a two-thread application using a message queue, semaphore or mutex. Explore calls in your own application and inspect frames and variables at a breakpoint. The generated applications build with west or CMake. [Thread tutorial](extension/guides/threads.en.md) · [Detailed design and verification](design/review/thread-studio.en.md) · [Offline interactive prototype](design/review/thread-studio-preview.html?lang=en)

## Commercial use and licensing

Zephyr View uses Apache-2.0, the same primary license as Zephyr RTOS. You may use, modify and distribute the project's original code, documentation and design assets in commercial products. When redistributing, include the license, preserve applicable copyright and attribution notices, and mark files you have modified. Bundled third-party components retain their own licenses. [Full license](LICENSE) · [Third-party notices](extension/ThirdPartyNotices.txt)

## Brand mark

<img src="design/marketplace-icon.png" alt="Zephyr View brand mark" width="64" height="64">

The white wing and two nodes on a teal background identify Zephyr View. The VS Code Activity Bar uses the same silhouette in the current theme’s icon color. [Download the 2048 × 2048 PNG](design/marketplace-icon.png) · [Download the color vector artwork](design/zephyr-view-logo.svg)

[简体中文](README.md) | **English**
