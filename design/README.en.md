# Zephyr View interactive prototype

[简体中文](README.md) | **English**


[Current design and acceptance reviews](review/README.en.md) · [Module review and implementation order after the Build page](review/module-refinement.en.md) · [Local file selection and initial discovery](review/local-selection.en.md) · [Open the interactive prototype](index.html#workspace) · [Installed extension guide](../extension/README.en.md) · [Interaction details](interaction.en.md)

The top bar contains Build, Workspace, Project Configuration and Modules, in that order. The first visit opens Workspace. Host tools and environment variables come first, followed by the optional west workspace. The browser uses a sample project. The installed extension reads the current project and local tools. The acceptance reviews track integration of installation plans, initialization and flashing.

## Try project configuration on a large screen

[Open Project Configuration](index.html#graph), select an application and board, then open the configuration in a new window. Use the canvas above to locate an input and the inspector below to examine its object and draft. Review differences before saving. Load an existing fragment and try saving and discarding changes in the demo project.

## Identify a module by URL or directory

Run `python preview.py` and open the local address it prints. Allow network access and paste a GitHub or Gitee page URL, HTTPS URL or SSH address. The prototype resolves the revision and module subdirectory from the page URL. Repository home pages default to HEAD. You can edit the target revision and checkout directory during identification. Queries run in a temporary bare repository and can use Git credentials already available locally. Paste an absolute local directory to inspect a module offline. To use a workspace-relative path, start the preview with `--workspace` pointing to the actual project root. When opening the HTML directly, use the directory picker for local directories or a hosting provider's cross-origin API for public repositories where permitted.

Discovery uses the name declared in `zephyr/module.yml` or `module.yaml`, falling back to the local directory name. Legacy modules are also recognized when both `zephyr/CMakeLists.txt` and `zephyr/Kconfig` exist. The UI lists the evidence and, for a remote source, the commit inspected. Confirm to add the module. [Zephyr module discovery implementation](https://github.com/zephyrproject-rtos/zephyr/blob/main/scripts/zephyr_module.py)

## Review the build method and module sources

**Build · west / CMake** stays visible on all four pages. Click to switch methods. Configure network access separately. With west, reuse an existing workspace or walk through one-click setup. CMake can configure an application from local sources, an SDK and modules without a `.west` directory.

Under **Workspace → Environment Setup → Build Process Environment**, inspect each variable's name, value for this process and source. A matching demo cache value reads “Matches build cache”. When values differ, both the current and last configured value are visible. Expand unset variables to check omissions. Under **Build → Target Compiler**, inspect local SDK components compatible with the board architecture, select another local toolchain or restore automatic selection. External GNU selection exposes the `CROSS_COMPILE` prefix. [Open Workspace](index.html#workspace)

Under **Build → Build Variables → Edit Additional Arguments**, enter `MY_OPTION:BOOL=OFF`, apply and choose Configure. The cache now shows `OFF`. Change it to `ON` to see the requested `ON` alongside the previously configured `OFF`. Expand More Variables for the application, build directory and additional target-specific values. The browser simulates configuration in memory. [Open the build variables example](index.html#build)

Under **Modules → Available Modules**, type a name to filter or choose **Search Online** to query official Zephyr repositories. A GitHub or Gitee link or local path triggers source identification. **Choose Directory** opens the picker. Review, edit and confirm the remote target revision and local checkout directory together. Online search authorizes this operation only. Expand the beginner guide for the expected directory structure and troubleshooting. [Module search UI](module-sources.png)

## Which commit will synchronization use?

Choose Sync or Download on a module and read **Project requirement**, **Local checkout** and **Target for this sync** from top to bottom. The requirement comes from the west manifest or the revision specified when adding the module. The local checkout is the commit the project currently uses. The target is the commit to check out after confirmation.

The default target follows the project requirement. To try upstream changes, switch an individual row to the latest branch revision, enter the branch or use the remote default, then choose Check Online. The result includes the resolved SHA and check time. In a batch, each row retains its own project requirement. Confirmation changes the demo checkout and marks deviations as temporary. Select the project requirement again to switch back. Existing local directories remain under their owner's control. [1920×1080 sync confirmation](module-sync.png)

## Set up the environment first

The prototype opens at **Workspace → Environment Setup**. Select Switch Sample Environment → New Machine and see how missing components affect Configure. In Prepare Installation Plan, switch between Windows and Linux to preview the host tools, Python environment, sources and toolchain needed for offline setup. Environment defaults and project overrides are kept separately. For each tool, change its source, inspect the detection evidence or restore inheritance. The product must establish availability by probing the actual environment.

[Archived environment design](environment.png)

[Missing components on a new machine](setup-empty.png) · [Project overrides and paths awaiting validation](project-tool-override.png)

**West workspace** sits below setup on the same page. Open an existing root containing `.west/config` or initialize from a local or remote manifest repository. Preview the command and confirm the root before managing modules and update scope. Unlinking changes the current selection in the extension. Standalone CMake applications can skip this step.

[Archived west workspace design](workspace.png)

[Command confirmation before initialization](workspace-init.png)

## Configure and build an application

[Archived build workbench design](build.png)

For `hello_world`, the application name is the page title with Configure and Build beside it. Read down through the target, inputs, actions, results and command preview. Search boards by name or CPU qualifier. Changing boards invalidates old results and makes Configure the primary action. Both methods share the application and board target so you can compare their commands. The installed product should generate the preview from actual arguments and quote copied arguments for the selected terminal.

In Zephyr, the application starts the build. `CMakeLists.txt` defines the application, `prj.conf` configures software, and overlays describe board hardware overrides. Configuration generates `.config` and `zephyr.dts` for different purposes from the input files. The workbench centers on the application and build directory and exposes west as a build option and workspace manager. Standalone applications can use CMake package discovery. The interface layout is an original design of this project. [Zephyr Application Development](https://docs.zephyrproject.org/latest/develop/application/index.html) · [Zephyr CMake Package](https://docs.zephyrproject.org/latest/build/zephyr_cmake_package.html)

## Responsibilities of the four pages

| Page | Object | Design decision |
| --- | --- | --- |
| Workspace · Environment Setup | Host tools, Python environment, Zephyr sources, SDK or external toolchain, runners | Show source, project override and validation beside each setting. Existing tools and local dependency packages support offline setup. |
| Workspace · west | West root, manifest repository and effective manifest | Associate, initialize, inspect the manifest, preview a full update and unlink on this page. |
| Build | One build of an application | Application, board, build directory and arguments share one page. Configuration and build reuse VS Code Tasks and their terminal. Diagnostics lead to Problems. |
| Configuration graph | Inputs for the selected build and image | Select an object in the graph and edit below. The model distinguishes explicit file values, draft values and the last evaluated result. Detach to a second screen when needed. |
| Modules | Workspace manifest and local application modules | Selected modules appear above candidates. Search and pagination belong to the candidates. Download or sync a row or the selection. |

Links in build results open read-only output. Configuration input links locate their nodes. Long-lived preferences stay accessible from VS Code Settings. The workbench provides task navigation. Separate windows support side-by-side configuration graphs or native files. Routine navigation reuses the workbench.

## Configuration graph and when changes take effect

[Archived configuration graph and draft](configuration.png)

Edges represent the application's configuration hierarchy. Expand menus to find software symbols or follow a bus to a peripheral. Double-click a node to edit beside it. Drag a blank area to pan or use Ctrl + wheel to zoom at the pointer. Beside Search, choose Locate Selected Node after panning, or Fit Graph to see all expanded branches. Full-screen and detached windows have bottom controls for the inspector and draft review. Try changing `CONFIG_PRINTK` from `y` to `n`. Open the same draft in a separate window and discard it to update both. Save to Project marks the file as changed and the Build page requires reconfiguration. The prototype uses memory. See the interaction notes for file consistency, Kconfig dependencies, multiple images and conflicts. [Interaction details](interaction.en.md)

## Layout and appearance

[Archived design at different editor widths](responsive.png)

- **Regular editors** use one horizontal navigation level, a stable header and vertically stacked inputs and results. Actions sit beside their objects. Short pages end with the content.
- **At or below 740 px**, spacing tightens and content wraps as needed, retaining all four text navigation items. Module versions move below the name and individual downloads remain accessible. At 420 px the path label moves above the value.
- **Short windows** scroll vertically. The canvas and long lists scroll independently and pass scrolling to the page at their boundaries. The top bar provides navigation. Users control the terminal and sidebar.
- **Light and dark themes** share status meanings and labels. Green accompanies “Synced”, amber “Version differs”, and neutral “Not downloaded”. Use monospace for paths, revisions and commands. The product maps colors, system fonts, focus and high contrast to VS Code tokens.
- **Shortcuts** stay visible inline where space allows. Secondary maintenance actions may move into More at narrow widths. The same operations are available by keyboard. After a move or edit, the product should restore focus to the control and announce the result to screen readers.

[Archived dark module list](modules-dark.png)

## Interaction review walkthrough

1. Select New Machine in Environment Setup, preview a Linux or Windows installation plan, then simulate preparation and validation. Open Workspace and initialize from a local manifest before viewing modules.
2. Switch between west and CMake on Build and compare the commands. Filter for a different target and observe when Build becomes available again.
3. Open software configuration, edit a value, stage it and detach the window. Discard or save, then check whether the Build result is stale.
4. Allow network sources, search for `mbt` on Modules, select `mbedtls` and sync the selection. The selected section above should stay visible.
5. Under Sources and Toolchains, enter a local SDK directory. Narrow the browser and switch themes to check that paths, actions and versions stay legible.

This review covers browser interactions and layout. The current review records native extension builds and file writes. Hardware flashing has separate acceptance criteria. [Current review](review/README.en.md)

### Run and Debug sidebar

The browser prototype initially shows the debug target beside the workspace. Toggle its sidebar at the upper left. Start the debug demo and select a stack frame to inspect sample source, or open Project Configuration while observing the session on the left. On small screens, expand as needed. A detached configuration window uses the full canvas. [1920×1080 preview](debug-sidebar.png)

The native extension adds a Zephyr debug target to VS Code Run and Debug. Variables, Watch, Call Stack and Breakpoints use data from the active debug adapter. [Native extension guide](../extension/README.en.md)

[简体中文](README.md) | **English**
