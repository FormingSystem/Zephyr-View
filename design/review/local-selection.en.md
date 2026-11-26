# Local paths, file selection and workspace discovery

[简体中文](local-selection.md) | **English**


## What users see

Options, candidate lists, the configuration graph and the debug sidebar all display local paths as `path/file`. Windows path fields accept both separators. Directory pickers and file actions use the original address. The command preview preserves the text the task actually receives.

| Object | Primary action | Alternatives and scope |
| --- | --- | --- |
| Application directory | Choose Browse Directory… on the build target or in Project Configuration and select the application in the system dialog. | Fuzzy-search discovered applications or enter an absolute or project-relative path. Validate application files in the selected directory. |
| Build directory | Browse Directory… for an existing build tree, or create a folder in the dialog. | Reuse a known directory. Confirm creation before adopting a new path. If a regular file was selected, ask the user to select again. |
| Board and CPU | Search by board, revision or CPU qualifier in the target row and select a match. | This row submits the complete `BOARD`. Use a directory picker only to select another Zephyr source tree. |
| Tools and SDK | Discover SDK compilers for the target and choose from the list. For external GCC, browse to a file or enter a prefix. Browse for a source or SDK directory. | `CROSS_COMPILE` is the external GNU tool name prefix. For a standard board and SDK, select the board and configure, then inspect the actual compiler. |
| Local module | Choose the repository root or enter a workspace-relative path such as `modules/hal/vendor` in the candidate section. | Show the name and evidence after detecting the module entry point. Resolve relative paths from the current VS Code project root. Remote checkout destinations are also constrained by the workspace boundary. |
| Kconfig and overlay | Open Existing File… or New File… uses native open/save dialogs with purpose-specific filters in the installed extension. | The new destination first enters the draft. Check the file on save to protect originals. To participate in the build, selected files must follow Zephyr's `CONF_FILE` or `DTC_OVERLAY_FILE` rules. |
| Initial workspace | Review detected Zephyr source, SDK, application and local module candidates and their evidence. | Temporarily use a unique valid match. Select among conflicts. Write workspace configuration only after explicit confirmation. Existing explicit settings take priority. |

Browse filesystem objects with native pickers and search logical objects in the workbench. The Windows dialog supports creating directories. On Linux, remote hosts and systems with simplified file dialogs, VS Code determines the dialog's appearance. A relative path typed in the system dialog depends on its current location. Enter Path in the extension resolves from the current project root. Explain each base at the relevant control. [VS Code open dialog](https://code.visualstudio.com/api/references/vscode-api#window.showOpenDialog) · [VS Code save dialog](https://code.visualstudio.com/api/references/vscode-api#window.showSaveDialog)

## Check the design

1. Open Initial Workspace Discovery in [Workspace](../index.html#workspace). The example has two applications. Temporarily adopt one and check the build target, then choose Save to Demo Workspace and inspect its state. The demo registration resets on reload.
2. In [Build](../index.html#build), cancel Browse Directory… once and then select a directory. Confirm cancellation preserves the value. In the confirmation dialog, complete the browser-granted directory name with an absolute or project-relative location. Use Search Applications and Select Target to find applications and boards.
3. In [Project Configuration](../index.html#graph), open an existing `.conf` in the inspector and create an `.overlay`. Review the draft, save only to the demo project and reopen the copy to check its content. New creates a demo copy in the browser and leaves disk originals intact. Native dialogs and real project writes have separate acceptance checks.
4. Under [Modules](../index.html#modules), enter `modules/hal/vendor` or a local absolute path. Start the preview service with `python preview.py --workspace "<actual project root>"` to set the base for relative paths. Without the argument, use the browser directory picker or an absolute path. The preview service does not infer the directory open in VS Code.

**Verified browser behavior.** Windows Edge at the existing local preview URL exercised temporary adoption and explicit saving, absolute and relative target paths, fuzzy application/board search, reading configuration, returning to edit a draft, reopening after save and creating an overlay. Controlled picker results verified selection and cancellation callbacks. A browser file selection event verified reading an existing file. These checks establish the sample state transitions and UI behavior.

## Windows installation acceptance for 0.5.3

- The primary application and build directory actions opened the Windows system picker in VS Code, allowing directory selection and folder creation. Cancellation preserved the prior value. Enter Path… was tested with an existing relative directory containing spaces, an absolute path outside the project, and a new multilevel Chinese path. New directories were created only after confirmation.
- Read-only scanning of a real workspace identified `applications/component_hello`, `zephyr-main`, SDK 1.0.1 and 63 module directories. Two same-name copies without manifest evidence required explicit selection. For a manifest-managed module with a duplicate name, the UI displayed the manifest path and the other local path. Discovery did not download, select or build all modules.
- The final VSIX ran in isolated VS Code against a test directory with an application, sources, two SDKs and one local module. Tests covered temporary adoption of a unique candidate, competing SDK choices, deferring save, an unchecked local module, redetection and saving. Before confirmation all existing settings on disk matched. Confirmation added only `zephyrWorkbench.locations`, with all four kinds of paths relative to the project root. [Installed UI at 1920×1080](installed/detected-workspace-0.5.3.png)
- Regression coverage included existing settings, build caches, explicit empty module lists, multiline CMake and comments, Windows junctions and build directory exclusions. Native file dialog tests covered opening existing configuration, cancelling, creating then discarding, confirming save, name collisions and save conflicts. Linux desktop dialogs still required a native retest at this point.

[简体中文](local-selection.md) | **English**
