# Board, architecture and sample discovery across a Zephyr checkout

[简体中文](catalog-coverage.md) | **English**

Tested on Windows on 2026-11-26 with a local Zephyr 4.5.0-rc1 checkout at `25c8f4a23988dd3b2cfb463613622738298c2d6c`. Discovery produced the same results for the standalone source directory and the current west workspace. These counts describe targets available in the picker and information available before configuration. Actual firmware builds are documented in the [native build comparison](adaptive-builds.en.md) and the [previous multi-architecture build review](multi-board-build.en.md).

| Check | Result | Reference |
| --- | ---: | --- |
| Board names / distinct SoC names | 1,191 / 722 | Hardware model from the selected checkout's `scripts/list_boards.py` |
| Boards declaring CPU clusters | 272 | SoC `cpuclusters` field |
| Fully qualified targets listed | 2,014 | 1,841 with unspecified revision and 173 with explicit revision, each checked against the west listing |
| Architectures known before configuration | 1,859 | Checked by board, revision, SoC, CPU and variant against Twister's `generate_platforms()` |
| Targets without a matching Twister architecture | 155 | Retain the targets and read `CONFIG_ARCH` after configuration |
| Board DTS found | 1,921 | Each resolved absolute path matched Zephyr's `dts_configuration_files()` |
| No standard board DTS found | 93 | Running the official function without application, shield or custom inputs returned `boards/common/stub.dts` for all 93 |
| Naming conflicts | 0 | Separate regression cases cover long and short names coexisting and multiple SoCs sharing a short name |

Targets with architecture declarations comprise 1,235 ARM, 242 RISC-V, 185 Xtensa, 96 ARM64, 42 ARC, 30 x86, 13 RX, 7 POSIX, 3 SPARC, 2 MIPS, 2 TriCore, 1 Hexagon and 1 OpenRISC. Different cores and revisions of the same board count separately. west produced 2,016 lines, including two duplicate `board@/soc/cpu` spellings from an empty revision on the same board. Zephyr's `parse_board_components()` requires a revision after `@`, so the picker groups these under the existing `board/soc/cpu`.

A board catalog can list a CPU even when the board lacks a firmware configuration for it. For example, `96b_meerkat96/mcimx7d/a7` appears in the west listing and fell back to the common stub in the devicetree check with no extra inputs. Applications, external modules, build arguments and custom CMake can supply further inputs. For a complete application, use the paths recorded in `build_info.yml` for that configuration.

### Sample applications and multiple input files

Scanning `samples/` for descriptor filenames recognized by Twister found 677 descriptor directories, each with a `CMakeLists.txt` and an entry in the application picker. The picker found 719 entry points in total. The additional 42 include child applications in multi-image projects. All 10 entries in `samples/modules/` are discoverable. Custom directories need no sample descriptor: discovery can use Zephyr declarations in `CMakeLists.txt`, or the user can specify the path.

Of the described applications, 115 have multiple `.conf` files and 18 have multiple `.overlay` files at the root. These counts cover only the application root. Selectable files can also live in subdirectories such as `boards/` and `socs/`. For example, `samples/subsys/usb/shell` has no `prj.conf`. Its `tests.yaml` uses parameters such as `FILE_SUFFIX=device` and `host` to select the corresponding application configuration. Application discovery does not require a unique configuration or devicetree.

### Reproducing the check

At the extension project root, use a development terminal with CMake, Node.js and the selected Zephyr branch's Python dependencies installed. Set `ZEPHYR_BASE`. Optionally set `PYTHON` to the environment's Python executable. The second command also requires west in that environment and a checkout in an initialized west workspace.

```text
node tests/integration/catalog-coverage.cjs
node tests/integration/catalog-coverage.cjs --workspace
```

Add `--details` to list every target for which no standard DTS was found. The check compares each target with the actual checkout's hardware description, Twister architecture and CMake devicetree input resolver. It stores comparison data in a temporary directory. The build matrix checks configuration, compilation, linking and build artifacts separately.

[简体中文](catalog-coverage.md) | **English**
