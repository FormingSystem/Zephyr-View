# Comparing project discovery with native builds

[简体中文](adaptive-builds.md) | **English**

Verified on 2026-11-26 with Windows x64, Zephyr 4.5.0-rc1 (`25c8f4a23988`), SDK 1.0.1, west 1.5.0 and CMake 4.4.4.

## Five ways a project can configure its build

Each scenario started with separate empty directories for native tools and the extension. The extension test exercised target selection, file selection, readiness checks and command generation, then ran the generated configure and build commands. Both paths checked the board, CPU qualifiers, configuration files and devicetree merge order in `build_info.yml`, then checked the final values in `.config`, `zephyr.dts` and the ELF header. All five scenarios passed. [Validation script](../../tests/integration/adaptive-build.cjs)

| Scenario | Application or board | Results on both paths |
| --- | --- | --- |
| Project sets board and application configuration | Before `find_package(Zephyr)`, the application sets `BOARD=mps2/an386`. A CMake function constructs the variable name and selects `profiles/shipping.conf`. The root also contains an unrelated `.conf` | CMake used the Cortex-M4 board and generated an ARM ELF. Stack size was 2048 and the application had no overlay. The workbench located the relative configuration path recorded by the build |
| Board alias and empty configuration | Through `ZEPHYR_BOARD_ALIASES`, west maps `lab_smp` to `qemu_riscv32/qemu_virt_riscv32/smp` and passes `CONF_FILE=` explicitly | The RISC-V ELF used the default stack size of 1024. The application configuration file list was empty and the adjacent `unused.conf` was excluded |
| Board directory without a DTS | The test board in `BOARD_ROOT` uses the AN386 SoC. Its directory has no `.dts`. An application overlay supplies the hardware nodes required for the MCU build | CMake used Zephyr's `boards/common/stub.dts`, merged `app.overlay` and generated an ARM ELF |
| Official sample selects a shield and overlay | The official `samples/shields/npm2100_ek` selects the `npm2100_ek` shield and button overlay on `nrf52840dk/nrf52840` | west used the board DTS, shield overlay, application board-specific overlay and application-selected button overlay in that order. The result was an ARM ELF |
| Custom configuration directory, external files and reset | A `qemu_x86/atom` project sets `APPLICATION_CONFIG_DIR` to `profiles`. In the same build directory, select two external `.conf` files and two external overlays, then restore automatic selection | With `profiles/prj.conf` and `profiles/app.overlay`, the default stack size was 1536 and the model was `shipping`. Manual selection produced 3072 and `variant`. Reset restored both project values. All three builds produced an Intel 80386 ELF |

An independent native build with defaults served as the reference for reset. The extension ran seven builds and the native comparison ran six. External files, test boards, logs and artifacts are in the system temporary directories printed during the run.

## CMake with local components

In a temporary Python environment, importing `west` failed and `PATH` contained no west executable. The extension opened a standalone `hello_world` application, used the local SDK, selected `cmsis_6` via `ZEPHYR_MODULES`, and compiled and linked an ARM ELF for `mps2/an386`. The cache recorded `WEST:INTERNAL=WEST-NOTFOUND`. Only the selected module appeared in `zephyr_modules.txt`. This test used tools and libraries already installed on the host. To reproduce it, set `ZEPHYR_BASE`, `ZEPHYR_SDK_INSTALL_DIR`, `ZEPHYR_MODULES` and the `PYTHON` used to prepare the temporary environment, then run `node tests/integration/no-west-build.cjs`. [Build without west](../../tests/integration/no-west-build.cjs)

## Two CPU images in one project

The official `samples/sysbuild/hello_world` sample targets the nRF5340 DK. For both west and CMake, the extension enabled sysbuild, built in an empty directory, then reconfigured and built again from the same root. All four runs passed. The test read the default domain `hello_world` and second domain `remote` from `domains.yaml`, then checked each processor in its domain's `build_info.yml` and ELF. [Dual-image test](../../tests/integration/adaptive-sysbuild.cjs)

| Build domain | Board and CPU | Artifact |
| --- | --- | --- |
| `hello_world` | `nrf5340dk/nrf5340/cpuapp` | `hello_world/zephyr/zephyr.elf`，ARM |
| `remote` | `nrf5340dk/nrf5340/cpunet` | `remote/zephyr/zephyr.elf`，ARM |

The top-level CMake project is `sysbuild_toplevel`. `APP_DIR` points to the user application and `APPLICATION_SOURCE_DIR` points to Zephyr's sysbuild template. The build root manages all images. The default domain supplies the board devicetree and Kconfig information for the current application.

A separate copy of the nRF5340 DK sample went through four configurations in the same build directory: initial values, manual application-core `.conf` and overlay selection, restoring the project settings, and reconfiguration after editing the application's default files. The application-core stack sizes in the last three rounds were 1536, 2048 and 2816 bytes. The corresponding devicetree `model` values were `selected`, `project` and `changed`. The network-core `.config` and `zephyr.dts` remained byte-for-byte identical across all four rounds. Single-image MPS2 sysbuild also passed the last three rounds. [Selection and reset test](../../tests/integration/sysbuild-file-reset.cjs)

## Reproducing the checks

From the extension repository root, use a development terminal with the Zephyr source, SDK, modules and Python environment configured:

```sh
node tests/integration/adaptive-build.cjs
node tests/integration/adaptive-sysbuild.cjs
node tests/integration/sysbuild-file-reset.cjs --dual
```

The first command accepts scenarios `app-owned`, `empty-alias`, `stub`, `shield` and `manual`. The first two commands compile and link actual firmware with four parallel jobs per build. The third reconfigures in the same directory and reads the generated files for both cores. Omit `--dual` for single-image MPS2. Each command prints the log and artifact locations. Flashing, execution on hardware and other board/application combinations need separate checks.

The test machine's existing Python environment had a different version of `python-devicetree`. Both native and extension x86 builds encountered a missing `_LocalProps` during page-table generation. Adding the checkout's `scripts/dts/python-devicetree/src` to `PYTHONPATH` for the test process allowed both builds to complete. On Windows these versions of west and CMake pass a backslash-separated `APP_DIR` to sysbuild by default. This can cause CMake escape errors when expanding Kconfig targets. Both extension entry points completed the build with the path converted to CMake syntax.

[简体中文](adaptive-builds.md) | **English**
