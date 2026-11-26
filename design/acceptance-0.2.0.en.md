# Zephyr Workbench 0.2.0 design acceptance review

[简体中文](acceptance-0.2.0.md) | **English**


Historical acceptance record. See the current four-page workbench in the [design review](review/README.en.md).

Reviewed on 2026-11-25 against the [design](README.en.md), [interaction and acceptance criteria](interaction.en.md) and installed VSIX. The six principal implementation files matched byte for byte in the installation directory, VSIX and project directory. The table records the scope delivered in this version.

| User workflow | Installed behavior | Remaining design requirements |
| --- | --- | --- |
| Enter from the Activity Bar | Click the Z icon to switch five pages in one central tab, with the debug target on the left | Show the actual build method across pages. Check the installed extension in narrow, dual-screen, light and dark layouts. |
| Set up a new machine | Finds CMake, west, Ninja and Git paths and shows four extension-process environment variables | Detect Python, DTC, SDK and toolchain versions. Verify online preparation, offline packages, local paths, project overrides and the actual child-process environment. |
| Manage a west workspace | Finds .west/config from an existing directory and opens the config and manifest | Local and remote initialization, switching associations, previewing updates and recovery. |
| Select an application and board and build | Select an existing build directory, run CMake or west builds there and invoke menuconfig | Start from an uncached application. Scan boards and CPUs with fuzzy selection, preserve user arguments, configure and build for the first time and verify artifacts. |
| Graphical configuration | Open application inputs and existing generated Kconfig and devicetree outputs in the editor | Graph navigation, official evaluation, isolated drafts, diffs, conflict checks, writing back to the project and detached-window synchronization. |
| Determine required modules and versions | Shows manifest-declared names and revisions and can run west list in the terminal | Derive dependencies and reasons from project configuration, verify multiline and whitespace handling, display the project requirement, local commit and sync target, and distinguish missing, synchronized and divergent modules. |
| Obtain and sync modules | Open the local manifest for inspection | Workspace, official online, personal online and local directory sources. Identify GitHub/Gitee URLs and directories, search candidates, download individually and in batches, recover from failure and protect dirty worktrees. |
| Flash, debug and test | View the default debug runner and start an existing VS Code debug configuration | Check a real board, image, flash and debug session. Integrate Twister and navigable diagnostics. |
| Publish and teach | Local VSIX, Chinese and English entry points, README and Windows screenshots | End-to-end project acceptance on Windows and Linux, bilingual beginner guides and demos with pointer guidance, copyright boundaries for the independent project and a Git history reviewable by feature. |

## Scope of existing validation

Windows VS Code validation covered the Activity Bar, switching between five pages, viewing a sample manifest revision, opening prj.conf and reusing the editor tab. The build fixture was a CMake project using project(Integration NONE) whose target created a build-ok marker. It exercised the extension task from launch through local command completion. No Zephyr firmware was compiled. The software debug session test also used no hardware probe.

## Acceptance scenario for the first usable version

Choose the same real Zephyr application and board in clean build directories. Use west first, then offline CMake without west. Check modules and pinned versions, actual build arguments, final .config, zephyr.dts and ELF. Change one Kconfig setting and one overlay. Verify discarding the draft preserves the file, then save and rebuild to confirm the expected differences. Run the scenario on Windows and Linux and retain the logs. Evaluate remaining items separately against the table above.

## Increments verified in 0.3.0

The planned Build page now supports application and board selection, initial configuration, builds and command previews. The Z icon opens the same workbench, whose header identifies the application, target and method. The sidebar retains the workbench entry and debug target. Manually supplied CMake definitions are stored separately, so changing board preserves the user's argument text. When the build directory is bound to another target, the UI asks for an empty directory.

In Windows VS Code, two fresh build directories were used for the official Zephyr 4.5.0-rc1 hello_world sample on mps2/an386 with SDK 1.0.1. Tests started at the actual Activity Bar, selected the application, searched the local Zephyr board database for the qualified target, configured and built, checked the ELF header, .config and zephyr.dts, and opened generated configuration from the result list.

| Build method | Conditions | Observation |
| --- | --- | --- |
| west | Existing local west workspace, modules and toolchain | west configured and built successfully and produced an ARM ELF. |
| CMake | Standalone application, no west in the Python environment or PATH, ZEPHYR_MODULES pointing to local cmsis_6 | The cache recorded WEST-NOTFOUND. Configuration and build succeeded and produced an ARM ELF. |

[1920×1080 screenshot of the running extension](vscode-build-0.3.0.png). This acceptance run used existing local tools and an SDK. Full environment installation, generic module dependency inference and download, saving graphical Kconfig/devicetree drafts, Linux and physical-board validation remain subject to the criteria above.

[简体中文](acceptance-0.2.0.md) | **English**
