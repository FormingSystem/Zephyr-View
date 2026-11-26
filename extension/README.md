# Zephyr Extension

**简体中文** | [English](README.en.md)

在 VS Code 中使用 west 或 CMake 构建固件，查看开发板、管理模块，编辑 Kconfig 与设备树。在 VS Code 的活动栏打开 **Zephyr Extension** 即可开始配置工程。支持本地工具、离线 SDK 和已有的 west 工作区。

工作台和调试侧栏中的本地路径统一使用 `/`，例如 `samples/hello_world`。Windows 的「输入路径」也接受从资源管理器复制的 `\` 写法。

点击 VS Code 活动栏的 **Z 形芯片** 打开工作台。工作台默认打开「工作区」。顶部从左到右依次为构建、工作区、工程配置和模块，右上角显示当前使用的 west 或 CMake。调试目标在 VS Code 左栏，变量、栈帧和断点在原生「运行和调试」中。

**多个工程文件夹**　在调试目标侧栏点击「工作区文件夹」可切换工程。打开工程内的文件，或激活归属于该工程的调试会话，也会切换。转到工作台或终端会保留当前工程。「调试运行器」取自当前应用和板生成的 `zephyr/runners.yaml`。换板、配置失败或未指定运行器时，侧栏显示原因；点击列表末尾的「刷新调试目标」可重新读取。

**在新电脑搭建环境**

1. 打开「工作区 → 环境搭建 → 补齐缺失组件」。核对与当前 west 或 CMake 工程有关的缺项，勾选后可采用默认安装方式，也可逐项选择工具、安装位置或离线包。完成一项会重新检测。Windows 10/11 有 WinGet 时可调用它，也可使用 MSI/EXE。Ubuntu 使用 APT 或本地 DEB。macOS 使用 Homebrew、PKG 或 DMG，打开 DMG 后按发行方说明完成安装。单项操作与官方下载页在各工具行中。
2. 在「Python 环境」给 west 或 Zephyr 构建依赖选择虚拟环境。离线安装时选本地 wheel 目录，目录中要包含适配此 Python 和宿主机的依赖包。
3. 在「源码与工具链」设置 `ZEPHYR_SDK_INSTALL_DIR`。已有 SDK 可从目录复用。新安装可选官方完整包，离线安装时准备完整包与同一版本的 `sha256.sum`。具备 `west sdk` 的工作区还可按目标选择 GNU 工具链。核对目录、版本和 CMake 包注册范围再安装。[SDK 官方发布包](https://github.com/zephyrproject-rtos/sdk-ng/releases)
4. 在「构建进程环境 → 注册环境变量」核对旧值和作用范围。Windows 可选当前用户或系统。Ubuntu 的 `environment.d` 适用于新的 systemd 用户会话。macOS 可将变量应用于当前登录会话，由 launchd 启动的新程序继承，注销后失效。只给工程使用时保留工作区设置即可。[Windows 变量范围](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables) · [Linux 用户会话环境](https://www.freedesktop.org/software/systemd/man/latest/environment.d.html) · [Apple launchctl](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchctl.1)

**换电脑或换目录**　在 VS Code 的扩展视图选择「从 VSIX 安装…」，从任意目录选安装包。工具在自定义目录时，打开「主机工具 → 工具搜索目录…」，选择存放可执行文件的文件夹。选在工程内的目录会作为相对路径写入工作区设置，工程外的选择仅在当前环境保存。进入「源码与工具链 → 获取源码…」可以选择解压到任意位置的 Zephyr，或选择官方版本，按当前构建方式下载源码或初始化 west 工作区。跨系统搬迁时，为目标系统准备适用的 SDK，重新创建 Python 虚拟环境和构建目录。[Zephyr 官方安装说明](https://docs.zephyrproject.org/latest/develop/getting_started/index.html) · [Python 虚拟环境](https://docs.python.org/3/library/venv.html#how-venvs-work)

从外部安装 SDK、添加开发板或移动模块目录后，可在「工作区 → 环境搭建」点击「重新检测」，立即更新识别结果。重复打开页面会复用近期的查询结果，同步模块时仍会重新核对本地提交。

**离线识别模块**　在「构建」选择 CMake，打开「工作区」查看扫描到的本地模块。扩展识别 `zephyr/module.yml` 或 `zephyr/module.yaml`，也识别同时含有 `zephyr/CMakeLists.txt` 和 `zephyr/Kconfig` 的模块。模块放在自定义位置时，可在「模块」页选择其目录。勾选工程需要的模块，再配置构建。配置成功后，「模块」页会标明哪些本地模块已纳入当前构建，包括工程自行引入的模块。可用构建目录中的 `zephyr_modules.txt` 核对实际路径。[Zephyr 官方模块规则](https://docs.zephyrproject.org/latest/develop/modules.html#without-west)

**使用 west 清单**　构建、工程配置图和模块列表共用当前工作区的有效清单。导入项无法解析时，界面会标出范围。批量同步保留每个模块的结果，修复访问或版本问题后可重试剩余项。

**选择 SDK 版本**　优先使用工程源码推荐的版本。下载列表按所选版本实际发布的宿主系统和 CPU 包过滤。当前 Zephyr 入门指南面向 Ubuntu 24.04 LTS 及以后版本，macOS 面向 Apple Silicon。使用 Ubuntu 22.04 或 Intel Mac 时，需按工程版本核对工具版本和可用工具链。缺少兼容 SDK 包时仍可选已有工具链。[Zephyr 安装要求](https://docs.zephyrproject.org/latest/develop/getting_started/index.html) · [SDK 官方发布附件](https://github.com/zephyrproject-rtos/sdk-ng/releases)

**调整界面**　右上角的「工作台外观」可以预览跟随 VS Code、浅色或深色，并选择自适应、紧凑或宽松间距。点击「应用」保存到 VS Code 用户设置，按 Esc 取消预览。密度只调整间距，字体和缩放仍由 VS Code 控制。

**构建页**　先选 west 或 CMake，再确认应用、开发板与构建目录。点击「配置」或「构建」会列出这一步缺少的条件；点对应操作即可继续。需要核对版本、输入或命令时展开目标下方的相应分区。「命令预览」列出任务实际使用的工作目录、可执行文件和各个参数。含空格的路径仍是一个参数。

**探针与驱动**　在「工作区 → 环境搭建 → 探针与驱动」查看 CMSIS-DAP、ST-LINK、J-Link、USB DFU 和串口。打开列表会识别本机工具和已连接的设备。先看工具名和路径，再看设备名及驱动或访问状态；插拔设备后点击「重新识别」。选择某一行的「选择目录…」可指定已安装的工具或其 `bin` 目录。展开该行可以输入绝对路径或工程相对路径、选择可执行文件或恢复自动识别。烧写页的探针入口会定位到相应行。

支持自动部署的工具在该行提供「下载并部署」。已有厂商安装包可在支持的平台就地运行。Windows 的 ST-LINK 行可从解压的 STSW-LINK009 目录安装驱动；Linux 的 CMSIS-DAP 和 ST-LINK 行可部署 USB 访问规则，完成后重新插拔。标准串口行显示系统端口和访问状态。[ST-LINK 官方驱动](https://www.st.com/en/development-tools/stsw-link009.html) · [pyOCD 探针说明](https://pyocd.io/docs/debug_probes.html)

**固件烧写**　在「构建 → 固件烧写」选择本板支持的烧写工具。默认项来自当前构建的 `zephyr/runners.yaml`。多镜像工程按 `domains.yaml` 的烧写顺序显示，也可选择其中一个镜像。展开产物，核对镜像、设备和命令，再点击「烧写固件」。设备 ID 留空时由运行器选用默认设备。pyOCD 支持扫描探针，支持设备 ID 的其他运行器可输入探针序列号。在纯 CMake 工程中，「使用工程任务」可运行当前文件夹在 `.vscode/tasks.json` 定义的厂商烧写命令。「探针与驱动」用于检查对应工具。[Zephyr 烧写说明](https://docs.zephyrproject.org/latest/develop/west/build-flash-debug.html#flashing-west-flash)

| 入口 | 从哪里开始 | 如何核对结果 |
| --- | --- | --- |
| 构建 | 先在「构建方式」选择 west 或 CMake，再选应用、开发板与 CPU、构建目录。应用、构建目录可直接浏览系统目录、搜索已有项或输入路径。板与 CPU 在当前行搜索，例如输入 `mps2an386` 查找 `mps2/an386`。检查自己的附加参数，点击「配置」再「构建」。 | 「可配置」和「可构建」分别核对当前方式的条件。条件不齐时点击「构建」，即可展开全部已识别的缺项，直接补选应用、板或工具。命令预览可与任务终端核对，生成文件列在输入文件下方。运行任务需要受信任的工作区。 |
| 工作区 | 首次打开时先看「自动识别」列出的应用、Zephyr 源码、SDK 和本地模块。唯一候选临时生效，多候选在原处选择。点「保存到工作区」才写入设置。再在「环境搭建」检查主机工具、Python、源码与工具链。可指定本地工具或 SDK，也可恢复继承。向下查看构建进程环境，再进入 west 工作区。页首可直接定位到 west 部分。 | 对照路径、来源和构建方式。west 项目可打开 `.west/config` 和清单。使用已有源码与工具链的独立 CMake 应用可以跳过 west。 |
| 工程配置 | 从应用根节点展开开发板、Kconfig 菜单、设备树、模块和构建分支。双击具体符号或外设即可在节点旁编辑。鼠标按住画布空白处平移，按住 Ctrl 滚动滚轮可围绕指针缩放。 | 核对生效值和草稿，选择另存副本或写回指定应用文件。重新配置后再看该节点的构建值。 |
| 模块 | 待选区可以搜索本工作区清单，或从 Zephyr 官方仓库搜索、指定个人 Git 地址、选择本地目录。确认识别出的模块入口，再加入。 | 已选与待选模块分别按名称排序和分页。终端展开、编辑区较矮时，点击「已选模块」可展开默认收起的列表。在待选区点 H 可跳到以 H 开头的模块，例如 `hal_xhsc`；点「全部」返回完整列表。搜索会重新计算首字母和页数。「同步所选」包含其他页已勾选的可同步模块。同步前可核对工程要求、本地检出和本次目标。分支最新需要实际联网检查；本地引用目录由用户维护。 |

[观看配置图操作：展开、修改、另存副本（1920×1080，含鼠标指引）](media/guide/configuration-map.gif) · [观看模糊选板操作](media/guide/board-picker.gif)

**核对变量**　在「工作区」的环境搭建区查看构建进程可用的环境值及其来源。若只在当前终端里设置过变量，从该环境启动的 VS Code 才能继承它。在「构建」选择应用、板和构建目录后，展开「构建变量」中的更多项，可以对照本次配置输入和 `CMakeCache.txt` 记录。例如，上次配置为 `CMAKE_BUILD_TYPE=Debug`，本次应用附加参数 `CMAKE_BUILD_TYPE=MinSizeRel` 后，两个值可同时核对。运行「配置」后再看新的缓存值。刚选的新构建目录会先显示已有的输入。

**选择本地位置**　「选择目录…」打开 VS Code 的目录窗口，可在支持的系统对话框内新建文件夹。「输入路径…」支持绝对路径，或相对于当前 VS Code 工程文件夹的路径，例如 `build/debug`、`../zephyr-sdk`。构建目录尚未存在时会先询问是否创建。操作系统对话框地址栏中的相对路径以该窗口正在浏览的目录为准。系统工具、源码、SDK 和已有模块可以位于工程外。新建配置片段先生成草稿，点击「保存到工程」才写入。

**选用编译器**　在「构建 → 构建目标」选定开发板与 CPU 后，查看同一区域的「目标编译器」。保留「自动」时，先核对推荐的编译器可执行文件名及路径。配置成功后再核对 CMake 记录的实际编译器；即使两个工具同名，也可用完整路径区分。例如 `mps2/an386` 的 Cortex‑M4 使用 Zephyr SDK GNU 时对应 `arm-zephyr-eabi-gcc`。要换用自己的工具链，从列表点选并应用，或展开「指定其他外部 GNU 编译器」选择 GCC 文件。该选择随当前应用和板保存。兼容性待验证的候选也可选择，配置成功后由 `CMAKE_C_COMPILER` 显示实际结果。已有编译器的构建目录换工具链时请选择新的构建目录。自动模式使用自己填写的工具链 `-D` 参数。主动应用其他候选时，只为当前应用和板生成相应的构建参数。恢复自动后，可再次使用原先填写的值。自带开发板随 Zephyr 发现；使用树外板时，在开发板行下展开额外的搜索目录，选择含 `boards/` 的目录。[Zephyr SDK](https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html) · [外部交叉编译器](https://docs.zephyrproject.org/latest/develop/toolchains/other_x_compilers.html)

**由工程选择开发板**　「开发板与 CPU → 使用工程设置」沿用应用、环境或现有构建目录决定的 `BOARD`。要改选，在同一列表搜索板名和 CPU；厂商定义的别名或未列出的修订可点「使用此 BOARD」。已有构建目录绑定其他目标时，选择新的构建目录。配置后可核对目标架构和编译器。

**多份源码与选板排错**　同一目录下有多份 Zephyr 时，打开所需源码或其中的应用。打开共同父目录且没有清单、显式配置等依据时，在「工作区」选择本次要使用的源码。已有的 `ZEPHYR_BASE` 会显示其来源；构建缓存绑定其他源码时，为当前源码选择新的构建目录。构建页和配置图使用同一个选板器。搜索结果为空时，仍可输入完整的 `板名[@修订][/SoC/CPU]` 并点「使用此 BOARD」，也可用「添加板卡搜索目录…」选择含 `boards/` 的根目录、`boards/` 本身或其下的板定义目录。

「识别问题」会列出有问题的文件、解析器给出的原因和修复提示。点击「打开文件」检查 YAML 缩进、模块依赖、SoC 引用或清单路径，修复后重新打开选板器；工作区和模块的发现结果可在「工作区 → 环境搭建 → 重新检测」更新。板列表可保留独立的有效条目，最终能否配置和构建由当前源码的 Zephyr 工具判定。[官方板卡目标命名](https://docs.zephyrproject.org/latest/hardware/porting/board_porting.html) · [官方 west 板卡命令](https://docs.zephyrproject.org/latest/develop/west/zephyr-cmds.html)

**多镜像工程**　在新的构建目录勾选 **Sysbuild**，再运行「配置」和「构建」。已有的 sysbuild 根目录会自动识别。构建页列出 `domains.yaml` 中的镜像，标明主镜像；配置图展示主镜像的 Kconfig 和设备树。其他镜像可用 Zephyr 的命名空间参数配置，例如 `remote_CONFIG_DEBUG_OPTIMIZATIONS=y`。[Zephyr sysbuild](https://docs.zephyrproject.org/latest/build/sysbuild/index.html)

例如在 nRF5340 的双核工程里，为主镜像选一份 `.conf` 后，可以点「恢复工程设置」并重新配置。应用核会重新读取工程自己的文件，网络核继续使用自己的配置。调试某个核时，左侧显示该镜像，构建页仍可构建整个系统。

**选择构建输入文件**　在「构建」选择应用和开发板后，查看「板级设备树」「应用配置」「设备树覆盖」。工作台按目标识别板级 DTS，并按 Zephyr 规则查找 `prj.conf`、相应的 SoC 和板级片段以及可选的 overlay。按规则应当一起生效的多个文件会按合并顺序列出。配置目录内只有一份非标准命名的配置时，工作台列为候选。选择后才传给 `CONF_FILE`。板目录中缺少 DTS、存在多个候选或工程在 CMake 中动态设置输入时，仍可运行「配置」，再核对实际使用的文件。[Zephyr 配置文件规则](https://docs.zephyrproject.org/latest/build/cmake-ref/module/configuration_files.html)

有多个可用版本时，点击「从列表选…」搜索文件名或目录，或点击「浏览…」在系统文件选择器中指定文件。板级 DTS 单选，应用配置和 overlay 支持多选与调整合并顺序。手动选择对应 `DTS_SOURCE`、`CONF_FILE` 或 `DTC_OVERLAY_FILE`，只对当前工程文件夹、应用、板和构建目录生效。「恢复工程设置」会重新采用原有参数或 Zephyr 的自动规则。更改后运行「配置」。配置图的 Kconfig 和设备树分支也能选择来源，设备树分支可核对构建实际采用的文件及合并结果。[设备树覆盖文件](https://docs.zephyrproject.org/latest/build/dts/howtos.html#set-devicetree-overlays)

**并行编译任务数**　在构建页保留「自动」，会按运行构建的电脑可用的逻辑处理器数设置并发。已有的 `CMAKE_BUILD_PARALLEL_LEVEL` 会优先生效，可从列表选择其他数值或自定义，选 1 即串行。调整任务数可直接再次构建。举例，选择 4 后，命令预览中 CMake 显示 `--parallel 4`，west 显示 `-o=-j4`。目标芯片的 CPU 或核在「开发板与 CPU」中选择。[west 并行构建](https://docs.zephyrproject.org/latest/develop/west/build-flash-debug.html#build-parallelism)

**配置 Kconfig**　在扩展侧栏或「构建」页点「配置 Kconfig」。先为所选应用和开发板运行一次「配置」，再搜索符号或提示文字。例如搜索 `THREAD_NAME`，选择 `CONFIG_THREAD_NAME`，把值改为 `y` 并加入草稿。核对目标文件（如 `prj.conf`）与差异后点「覆盖工程原配置」，再运行「配置」核对实际值。若要浏览 Zephyr 原生菜单、帮助或依赖，打开图形工具 `guiconfig` 或终端工具 `menuconfig`。这两个工具默认保存当前构建目录的 `zephyr/.config`。[Zephyr Kconfig 交互界面](https://docs.zephyrproject.org/latest/build/kconfig/menuconfig.html)

**展开设备树**　在「构建」为当前应用和开发板运行「配置」。打开「工程配置 → 设备树 → 硬件节点」，从根节点 `/` 沿总线逐级展开外设，再展开属性查看本次配置生成的 `zephyr.dts` 中的值。有子设备时，本节点自己的属性收在「属性」分组内。再次单击可收起。可以搜索 `current-speed`，也可以用完整节点路径加属性名（`/节点路径:属性名`）区分同名外设。

**在图上改外设**　双击属性或选中后按 Enter。例如，串口有单值属性 `current-speed` 时，可输入 `57600`，选定应用的目标 overlay，再加入草稿。数组和 phandle 等复杂属性可查看完整 DTS 表达式。要让修改生效，先保存草稿到工程，再运行「配置」核对新值。开发板的基础 DTS 作为只读来源。

**选择写入哪份片段**　Kconfig 可同时使用主片段 `CONF_FILE` 和额外片段 `EXTRA_CONF_FILE`。下拉框用相对路径区分同名文件，并按本次构建记录显示合并顺序和是否已使用。旧版 Zephyr 未记录完整输入时只列已有候选。自选片段可单独保存，若要用于当前目标，再点「加入当前构建」并配置。

**副本与原件**　「另存副本」在系统保存对话框中选择新的 `.conf` 或 `.overlay` 文件名，磁盘原件和当前草稿均保留。要让本次修改进入工程，核对目标路径，使用写回原件的按钮；目标是新文件时则创建文件。如果原件已被其他编辑器更改，可以先另存草稿再处理冲突。重新运行「配置」后检查生效值。Zephyr 已缓存空的默认覆盖列表时，在扩展中首次创建 `app.overlay` 会让下次配置重新查找默认覆盖。显式指定的覆盖文件以及 Zephyr 自身的选择顺序仍优先。

**识别与保存**　扩展离线读取当前目录、常见子目录，以及应用旁的项目目录或 west 根。识别依据包括 Zephyr CMake 包、SDK 版本与包配置、应用的 `find_package(Zephyr)` 和标准模块入口。现有显式配置优先。有相同名称的多个模块时可选择所需副本。识别到的模块列为可用候选，选入构建仍由工程决定。「暂不保存」只使用本次结果；「重新检测」可再次查看。保存的设置为 `zephyrWorkbench.locations`，同一文件系统内使用相对路径，现有其他设置保留。

**离线使用**　在工作区选择本地源码、SDK、Python wheel 目录和工程所需模块。安装前可核对工具来源和目标目录。完整 Kconfig 依赖图、根据设备树绑定生成配置表单，以及按板自动下载全部依赖，仍在设计评审中。

**找回节点与全屏编辑**　在配置图搜索框右侧点「定位选中节点」，可将当前节点移回画布中央。点「适应全图」可查看所有已展开的分支。「全屏配置」使用整个显示器；有第二块屏幕时，可点「在新窗口配置」并将窗口拖过去。两种窗口底部都可展开配置检查器和草稿，核对差异、另存副本或写回工程。用右上角按钮返回原编辑器组时，草稿会一起带回。

<a id="english"></a>

**简体中文** | [English](README.en.md)
