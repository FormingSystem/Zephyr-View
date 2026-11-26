# Review of the first-build workflow

[简体中文](onboarding.md) | **English**

The exercise follows one application from host setup through board selection, library integration and a change in firmware output. For each step, a beginner should be able to find the page that owns the setting and verify its effect in Zephyr's generated files. [Follow the exercise](../../extension/GETTING_STARTED.en.md)

## Where each setting belongs

| Task | Where to make the change | How to verify it |
| --- | --- | --- |
| Prepare host tools or open a west workspace | On Workspace, Environment setup manages Python, the SDK and shared toolchain defaults. The west workspace section opens or initializes a workspace and provides manifest inspection and repair. | Check the source of each process variable and the manifest referenced by `.west/config`. A standalone CMake application can skip west initialization. [Workspace guide](../../extension/guides/west-workspace.en.md) |
| Choose an application, board, compiler and job count | On Build, select west or CMake, the application and the board. Target compiler shows the executable and lets you override it for this target. | After configuration, inspect `CMAKE_C_COMPILER` in `CMakeCache.txt`. A second build directory lets you compare two toolchains. [Toolchain exercise](../../extension/guides/cmake-integration.en.md) |
| Add a local library or board package | Select a directory on Modules and check the module. A hardware package declares its hardware search roots in `zephyr/module.yml`; the board then appears in the usual target picker on Build. | Find the module in the generated `zephyr_modules.txt`. Search for the teaching board `view_lab/view_m3` and inspect the configured `zephyr/zephyr.dts`. [Hardware porting exercise](../../extension/guides/hardware-port.en.md) |
| Change a software option or a devicetree property | In Project configuration, search for a symbol or expand a hardware node. Review the diff and save a fragment or write back to the selected project file. | Reconfigure and check the effective value in `zephyr/.config` or `zephyr/zephyr.dts`. Add a separately saved fragment to the build to activate it. |
| Get editable examples | Open Getting started from the Activity Bar or Command Palette. Run **Copy Tutorial Examples…**, pick a writable directory and open the copy in a new window. | The application, module and hardware package can each be edited. Reusing an existing destination prompts for a different folder. |

## Findings and fixes

- **Two controls edited the same target compiler.** Both Workspace and Build offered a writable picker scoped to the application and board. Build now owns that override. Workspace keeps the shared SDK, `ZEPHYR_TOOLCHAIN_VARIANT` and GNU prefix. On first switching the workspace variant to `cross-compile`, users can browse for GCC or enter a prefix even if there is no previous value. Switching back to the SDK keeps the prefix recorded by the previous build available for inspection.
- **A narrow editor clipped compiler controls.** At an editor width of 320 pixels, a long path widened a grid column and hid about 34 pixels of the English compiler selector and external toolchain controls. The column now shrinks to the available width.
- **Adding a local module could drop other dependencies.** With the example application outside a west workspace, a build Python with west installed and a west-managed Zephyr checkout, selecting greeting replaced the existing module list and removed CMSIS. This case now adds modules through `EXTRA_ZEPHYR_MODULES`. For a fully offline build without a default module set, `ZEPHYR_MODULES` supplies the complete local set for the target.

## Verification

1. **Layout and controls.** Replayed all four pages in Chromium using the extension's Webview HTML, scripts, styles and host data from a configured Cortex-M4 project. Added paths longer than 190 characters, multiple application candidates, a manifest revision and 16 sample module entries. Expanded the settings. Checked English and Chinese at five editor widths: 1280, 720, 480, 360 and 320 pixels. All 40 cases fit horizontally; navigation and ordinary form controls could be reached after scrolling. The configuration map retained its own panning area. Both languages also showed just the shared toolchain fields on Workspace and one target picker on Build.
2. **Firmware.** Built `mps2/an386` on Windows with Zephyr 4.5.0-rc1 in three configurations. West with SDK GCC 14.3.0 enabled greeting. CMake with a Python environment without west and the same SDK disabled greeting. The same offline Python with CMake and external GNU Arm GCC 10.3.1 enabled greeting. Checked the compiler cache entry, Kconfig, compiled sources and QEMU serial output. Both enabled builds printed `Hello from the local module`; the disabled build printed `Application only`. A separate build with `CONFIG_DEBUG_OPTIMIZATIONS` enabled contained `-Og` in the compiler command.
3. **Coverage limits.** The layout sweep rendered host data in a browser. It did not launch VS Code or open native file pickers at every width. QEMU exercised the firmware. Physical probes, board flashing and native macOS and Linux UI remain outside this check.

[简体中文](onboarding.md) | **English**
