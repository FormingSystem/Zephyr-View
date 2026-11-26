# 工作区、环境搭建与构建评审

**简体中文** | [English](environment-workspace-build.en.md)

在**工作区**内按纵向顺序操作。先确认打开的文件夹，选择主机工具、Python、Zephyr 源码和工具链，核对传给构建进程的值。同页下方列出可选的 west 工作区和清单。**构建**页负责选择应用、开发板与 CPU、构建目录和构建方式。配置项旁边显示实际来源，修改、恢复继承和重新检测都在该项所在处完成。已有工程可以从构建页直接开始。

本页将已接通的宿主行为、浏览器设计稿的示例操作和需要补齐的能力分别标明。表格中的验收条件用于逐项复核，实际执行过的结果见末节。工程文件和命令均以用户当前 checkout 为准。

自动发现、是否保存、原生选择窗口和路径基准的验收见[本机选择器与识别](local-selection.md)。

## 0.5.10 目标编译器

在「构建 → 开发板与 CPU」下方查看「目标编译器」。工作区的「源码与工具链」负责设置共享 SDK 和工具链变体，在选择外部 GNU 工具链时可指定工作区默认前缀。默认采用工程和 Zephyr 的选择。配置前的架构证据来自目标板的元数据；配置后可核对 `.config` 和 CMake 记录的编译器。手动应用候选时，选择绑定到当前工作区文件夹、应用和板。工程原始参数保留，恢复自动后可直接复用。改变已配置目标的编译器时，新构建目录可保留原有构建供对照。

| Windows 实际验收 | 观察结果 |
| --- | --- |
| CMake，Cortex-M3 | 未指定 SDK 目录时，从 CMake 注册的 SDK 发现 ARM GNU 编译器；配置后核对 `CMAKE_C_COMPILER` 并生成 ARM ELF。 |
| west，`qemu_x86/atom` | 本机 SDK 提供 `x86_64-zephyr-elf-gcc`，Zephyr 按板使用 32 位目标选项，产物为 i386 ELF。 |
| 外部 GNU 工具链 | 使用独立的 ARM Embedded GCC 配置和构建，CMake 缓存指向实际外部程序。 |
| 树外开发板 | 选取自定义根目录或其中的 `boards/`，扫描和实际构建均找到该板；另加的根可逐一移除，进程或工程提供的根继续参加搜索。 |

[配置前的推荐（1920×1080）](installed/build-compiler-detected-0.5.10.png) · [配置后的实际编译器（1920×1080）](installed/build-compiler-confirmed-0.5.10.png)

## 工作区内的环境搭建

| 编号与功能 | 交互和依据 | 当前实现与差距 | 可复验的结果 |
| --- | --- | --- | --- |
| ENV-01 工具发现 | 主机工具按名称列出有效路径、来源、状态及同一行的选择入口。区分“找到程序”和“验证版本”，便于定位 PATH 指向错误。 | 能从宿主 PATH 找到 CMake、Ninja、Git、DTC；能选择已安装程序。当前检测重在文件可执行性，尚无工具版本和最低版本检查。 | 将同名工具放到不同目录，只覆盖其中一项，任务使用所选程序，恢复继承后重新展示继承路径。有效路径与实际版本分开核对。 |
| ENV-02 Python 与 west | 将解释器、虚拟环境、west 和依赖包放在同组。创建、选用、修复虚拟环境是不同的操作。 | 会查找工作区 `.venv` 与 PATH，也可指定单独的解释器或 west。创建虚拟环境、检查当前 checkout 的 Python 依赖、通过本地 wheel 目录安装仍属设计方案。 | 分别用 Windows 的 `.venv/Scripts` 与 Linux 的 `.venv/bin` 复核路径。选离线包目录后应预览所用解释器和依赖来源，安装完成用该解释器验证导入。 |
| ENV-03 Zephyr 源码选择 | 显示 `ZEPHYR_BASE`，同时说明应用通过 CMake 查找 Zephyr 包。可以指定自己下载的 checkout。 | 能选本地源码目录。板卡扫描会使用其脚本。仅给出一个现存目录还不能证明它是可用的 Zephyr checkout。 | 分别选有效 checkout 与普通目录，后者应指出缺少的源码标志。配置后在目标缓存核对实际 `ZEPHYR_BASE`。 |
| ENV-04 SDK 与分散工具链 | 先选择开发板与 CPU，按板级元数据或该目标的 `.config` 确定架构，结合当前 Zephyr 和本机 SDK 的组件推荐编译器。 | 「自动」遵循工程与 Zephyr 的工具链选择。目标选择器可应用本机候选或浏览外部 GNU 编译器。`CROSS_COMPILE` 仅用于外部 GNU 前缀。SDK 压缩包导入仍待实现。 | 选 ARM、x86 和 RISC‑V 板核对推荐，再核对成功配置的 `CMAKE_C_COMPILER`。改用自己的 GCC、切换应用或板、恢复自动时，原构建与附加参数应可复查。 |
| ENV-05 覆盖、继承与范围 | 把变量原名、有效值、来源放在同一行。切换工作区或构建目标时，用户应能判断哪些设置继续生效。 | 环境覆盖写入 VS Code 的工作区状态，按打开的文件夹区分。构建参数另按应用目录区分。同一打开文件夹下多个应用的环境覆盖共享；界面描述应准确反映这个范围。 | 在一个工作区内切换两个应用，然后打开另一工作区，比较有效值。恢复继承后核对进程环境与原系统值，系统设置无改写。 |
| ENV-06 在线及离线准备 | 在同一个工作区块显示缺哪项、可用本地来源和下载计划。网络访问由用户选定的操作触发。 | 使用已安装 SDK、现成虚拟环境和本机工具已有入口。系统软件包、wheelhouse、SDK 归档的获取或安装计划目前由浏览器原型展示。 | 完全断网且依赖齐备时生成可执行文件。用缺少一个 wheel 的副本重试离线安装，应点名缺包并停留在当前操作。单独给定 `minimal` SDK 时应检查所需编译器。 |

Zephyr 的安装指南将主机依赖、Python 与 SDK 分开处理。SDK 可放在自定目录，部分安装包仍须另备对应架构的编译器。应用若通过 `find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})` 查找源码，可直接使用本地 checkout。离线 Python 包应交由选定解释器的 pip 从本地包集安装。[Zephyr 环境安装](https://docs.zephyrproject.org/latest/develop/getting_started/index.html) · [Zephyr SDK](https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html) · [其他交叉编译器](https://docs.zephyrproject.org/latest/develop/toolchains/other_x_compilers.html) · [Zephyr CMake 包查找](https://docs.zephyrproject.org/latest/build/zephyr_cmake_package.html) · [pip 本地包安装](https://pip.pypa.io/en/stable/user_guide/#installing-from-local-packages)

宿主负责发现与启动程序，页面只消费有效值。设计稿中的示例工具版本不能作为本机检测结果。[环境覆盖实现](../../extension/environment.js) · [工作区工具发现](../../extension/workspace.js) · [页面渲染](../../extension/media/setupViews.js) · [环境与工作区设计稿](../setup-design.js)

## west 工作区管理

| 编号与功能 | 交互和依据 | 当前实现与差距 | 可复验的结果 |
| --- | --- | --- | --- |
| WS-01 打开和定位 | 工作区概况列出 topdir、清单文件和本地配置。没有 west 工作区时仍可准备 CMake 环境。 | 从打开目录向父级查找 `.west/config`，解析 `manifest.path`、`manifest.file`，可打开原文件。 | 从清单仓库的下级目录打开，解析出相同 topdir。自定义清单文件名时能打开对应文件。独立应用继续进入 CMake 构建。 |
| WS-02 初始化 | 在工作区内先选本地清单仓库或远程 URL，再看目标目录、文件和 revision，确认后执行。 | 设计稿演示 `west init -l` 与 `west init -m … --mr …`。扩展宿主当前仅接通“打开已有”，需要新增本地/远程初始化任务和错误回显。 | 对两个新临时目录分别进行本地初始化和指定标签的远程初始化，重新读取各自生成的 `.west/config`。本地初始化过程可断网。 |
| WS-03 有效清单 | 在概况给出清单来源。若启用了 import、组过滤等功能，应标明有效集合及其计算方式。 | 可解析根 YAML 中的项目、默认 revision 和远程地址。模块页能在受信工作区用 west 枚举有效项目；工作区概况中的数量、前五项及离线回退来自根清单。回退原因与导入缺失还需要显示。 | 用仅含 import 的根清单与两个被导入项目对照 `west list`。去掉导入所需的本地内容后，页面区分读取失败、部分清单和真实的零项目。 |
| WS-04 修改清单和解除关联 | 提供当前清单旁的切换入口。说明将修改的配置及影响范围，结束后重新解析工作区。 | 能打开配置源文件。结构化修改 `manifest.path/file` 与解除关联的流程目前在原型中，宿主需补上预览、保存和刷新。 | 切换到第二份本地清单，确认视图展示第二份项目集合；取消时文件保持原值。解除关联仅改变扩展上下文，工程目录仍可使用。 |
| WS-05 检查与同步 | 把只读检查和写入磁盘的更新分为两个动作。同步前展示涉及项目、清单 revision 与本机状态。 | 工作区内可运行 `west list` 的 VS Code 任务。单模块同步细节由模块功能处理；工作区原型中的预览全量更新仍需接通实际计划。 | 执行检查后各模块 HEAD 未变。用有两个模块的临时工作区预览同步，取消后本地提交保持原值，再核对实际更新的项目与预览一致。 |

west 官方区分本地初始化、从清单仓库初始化和更新清单项目。配置界面沿用这些动词与 `manifest.path`、`manifest.file` 名称，整组工具可留在工作区内。[west 内建命令](https://docs.zephyrproject.org/latest/develop/west/built-in.html) · [west 清单](https://docs.zephyrproject.org/latest/develop/west/manifest.html) · [工作区宿主](../../extension/workspace.js) · [任务与有效清单读取](../../extension/workbench.js)

## 构建目标、配置与执行

| 编号与功能 | 交互和依据 | 当前实现与差距 | 可复验的结果 |
| --- | --- | --- | --- |
| BUILD-01 构建方式 | 选择 west 或 CMake，目标和命令预览同步更新。CMake 支持独立应用，来自用户所选本机工具链。 | 能按打开文件夹保存方式；有 west 根目录时默认 west，否则默认 CMake。两种方式通过同一份计划预览和执行。 | 新建无 `.west` 的独立应用环境，CMake 配置和构建可用。切到 west 而缺少工作区时，按钮旁显示所欠条件。 |
| BUILD-02 应用目录 | 优先用本机目录窗口，也可输入路径或在候选列表按名称、路径模糊选择。 | 根据当前工作区、源码目录、候选标记与 `CMakeLists.txt` 扫描应用。手工浏览目录仅检查是否有 CMakeLists，普通 CMake 工程也可能通过初筛。 | 用两个同名样例的不同路径测试搜索和选中，按 Esc 后仍是上一个应用。选择普通 CMake 工程时，后续应提示如何验证 Zephyr 包声明。 |
| BUILD-03 开发板、CPU 与 revision | 在目标行展开搜索并保留完整目标名。板卡限定符来自所选版本支持的硬件模型。 | west 优先调用其板卡枚举；CMake 用当前 checkout 的 `scripts/list_boards.py` 发现目标。旧 west 回退可能只枚举板名。可在开发板行追加或移除工作区 `BOARD_ROOT`。与进程及显式 CMake 根合并后的树外板已经过配置与构建验证。板修订版本及各模块提供的根应按实际工程核对。 | 对具有多个 CPU 或 revision 的板逐项选择，核对命令里的完整 `BOARD`。再加入树外板并检查，发现成功之后须实际配置通过。 |
| BUILD-04 构建目录与生成器 | 通过本机目录窗口选择或新建构建目录；已有构建树读取其中的生成器和应用信息。冲突时在原位置说明怎么换目录。 | 应用、板级目标与缓存冲突时会阻止复用。本次修复保留已有 CMake 生成器，新目录尊重进程 `CMAKE_GENERATOR`，缺省沿用插件原有 Ninja 默认。 | 用 Ninja Multi-Config 生成后再次配置同一目录，生成器不变；全新的目录无显式选择时得到 Ninja。切换另一块板时保留旧目录。 |
| BUILD-05 用户定义与模块参数 | 在选择器旁单列用户原有的 `-D` 值。板卡选择和自动模块参数不应冲掉用户输入。 | 支持每行一个 CMake 定义和带类型的键，检测手写 BOARD 冲突。同名用户定义优先于扩展生成的模块列表。取消最后一个已选模块时，旧缓存值可能继续被使用。 | 保存已有 `CONF_FILE` 后切换板卡，原文本保持。再取消全部自动模块并重复配置，检查缓存；修复需区分扩展生成值和用户显式值。 |
| BUILD-06 配置、构建和 menuconfig | 分开“配置”和“构建”，命令预览随输入更新，缺少条件时显示原因。menuconfig 使用已经配置的构建树。 | west 使用 `build --cmake-only` 配置，CMake 使用 `-S/-B`。两者分别调用 `west build -t menuconfig` 和 `cmake --build … --target menuconfig`，通过 VS Code 任务终端执行。 | 缺板时检查配置按钮解释。配置后再构建并打开 menuconfig，验证正确目标目录；查看该树的 `zephyr/.config`。 |
| BUILD-07 输入与生成物 | 输入按当前选中的应用展示，生成结果归属当前应用、板和构建目录。支持检查配置、展开设备树、定位 ELF。 | 本次修复将文件发现移到确定待构建目标之后。切换应用或板时，从所选应用的默认文件及显式配置/overlay 参数列出输入。匹配已有目标时显示缓存记录和其产物，生成的 `.config`、`zephyr.dts` 以只读方式打开。 | 在有不同配置文件的 A、B 之间切换。配置前就能看到 B 的输入，旧构建结果从 B 的列表中收起；切回 A 后恢复 A 的结果。 |
| BUILD-08 多镜像与目标操作 | 只有检测到实际镜像、运行器或测试入口才显示对应操作，并给出所用域和构建目录。 | 当前模型集中在单个构建树；原型中的多镜像/域与 Twister 场景需独立接入并验收。调试启动在 VS Code 侧栏有自己的入口。 | 以 sysbuild 管理的双镜像工程核对域、板、ELF 和运行器归属，对每个域分别执行适用的操作。 |

Zephyr 官方构建命令区分应用、目标、构建目录、配置和构建产物。搜索列表是本扩展的交互选择，采用 VS Code 选择器熟悉的搜索、确认、返回习惯。CMake 生成器一旦写入当前构建树就应沿用；显式环境值适用于新构建树。[Zephyr 应用开发](https://docs.zephyrproject.org/latest/develop/application/index.html) · [west 构建与调试](https://docs.zephyrproject.org/latest/develop/west/build-flash-debug.html) · [板卡硬件模型](https://docs.zephyrproject.org/latest/hardware/porting/board_porting.html) · [VS Code 选择器习惯](https://code.visualstudio.com/api/ux-guidelines/quick-picks) · [CMake 生成器](https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR.html) · [CMAKE_GENERATOR 环境值](https://cmake.org/cmake/help/latest/envvar/CMAKE_GENERATOR.html)

构建计划、目标发现、缓存读取和页面入口可分别复核。[计划与候选发现](../../extension/buildSetup.js) · [读取 CMake 与运行器元数据](../../extension/target.js) · [页内选择器](../../extension/media/targetPicker.js) · [VS Code 任务执行](../../extension/workbench.js)

## 交互复核顺序

1. 在窄视口和 1920 × 1080 桌面分别打开工作区，切换四个环境类别。当前类别、有效值和来源应在同一列阅读顺序内。切换中英文和明暗主题，长路径不应覆盖按钮，聚焦时能读到完整值。
2. 对一个本地现成工程同时准备两套构建目录。用 west 和 CMake 分别选择同一应用与目标，比较命令与最终生成物。一次只改变板卡或环境变量中的一项，定位到相应的命令、缓存和结果变化。
3. 在全新临时目录试用只读检查、初始化、离线依赖安装和解除关联。尚属原型的项目要在验收记录中标出，原型预置数据不能计为宿主执行成功。

### 变量值与来源

| 操作 | 预期结果 |
| --- | --- |
| 从工作区核对 `ZEPHYR_BASE`，临时采用识别结果，再保存到工作区 | 每次都能读到完整路径，来源分别反映当前来源、临时识别和已保存设置。只有缓存值的变量仍显示“进程未设置”。 |
| 在构建变量中添加 `MY_OPTION:BOOL=OFF`，配置后改成 `ON` | 本次传值显示 `ON`，当前目标的缓存保留 `BOOL` 和 `OFF`。用户可在命令预览核对下一次配置的输入。 |
| 分别设置 `COUNT=0` 和 `EMPTY=`，切换到新的构建目录 | 两个显式值均可读；新目录的缓存状态显示尚无记录。原目录的缓存继续归属于原目标。 |

## 本轮实测

Windows 上用扩展的构建计划驱动真实 CMake，临时目录包含空格。新目录按 `CMAKE_GENERATOR=Ninja Multi-Config` 配置，随后移除该环境变量，并对同一目录再次配置和构建。缓存保留 Ninja Multi-Config。另一份新目录无显式生成器，实际配置和构建均使用 Ninja。另核对 west 参数不会追加 CMake 的 `-G`。此用例隔离了生成器行为，使用无编译器要求的小型 CMake 工程。

同机另用本地 Zephyr 4.5.0-rc1、Zephyr SDK 1.0.1、现成 Python 虚拟环境和本地模块，测试官方 `samples/hello_world` 与 `qemu_cortex_m3`。通过扩展的 `describe` 生成实际任务参数，为 west 和 CMake 各建一个临时构建树。两套配置和编译均成功，各自产生 `zephyr/zephyr.elf`。测试使用模拟的 VS Code 路径与状态输入，实际调用本机工具；没有启动板卡、QEMU 或调试器，也未在本轮复跑 Linux。

另用两个临时应用复核 BUILD-07。A 的缓存包含自定义配置、生成的设备树与 ELF，切到 B 后只列 B 的输入；给 B 指定带类型的 `CONF_FILE:STRING` 与 `DTC_OVERLAY_FILE` 后打开对应文件清单。单独换板也收起旧产物。对照测试前后的 A 配置、CMake 缓存和生成文件，内容一致。

## 0.5.9 构建工作流

旧版在同一个 1920×1080 的 VS Code 窗口、763 像素高的编辑区测量：宽 1163 像素时，页面高 1837 像素，命令预览从第 1614 像素开始；分栏到 620 像素宽时仍需经过一个单独的「工程操作」面板才能到达预览。目录按钮和长路径在争夺同一行空间。

| 操作 | 设计决定和验收方法 |
| --- | --- |
| 选择方式与目标 | west、CMake 共用一行单选控件，可以用方向键切换。再依次选择应用、开发板及构建目录。字段过宽时整组换行，参数标记和按钮文案保持完整。 |
| 配置、构建与排错 | 把操作放在当前目标下方，按这次动作分别列出缺项和可执行的处理入口。构建失败时保留当前目标、退出状态和任务输出入口。 |
| 核对执行内容 | 命令折叠区呈现实际工作目录、程序和单个参数。从应用根运行时，界面短路径显示为 `.`。含空格的参数、引号、空值和标记为敏感的值分别核对。 |
| 比较参数、文件与产物 | 次要信息按用途折叠。宿主刷新时保留已展开项、未应用的参数、光标与正在搜索的候选，不会因为刷新而选择开发板。 |
| 调整个性化和窗口 | 三种间距共用 CSS 变量。用户在标题栏预览密度和明暗，应用后保存到 VS Code 用户设置。浏览器原型和扩展复用同一组控件，真实任务由宿主执行。 |

配色跟随宿主时采用编辑器、按钮、边界和焦点的主题颜色。分别以普通主题和高对比主题检查正文、选中态和键盘操作。依据见 [VS Code Webview 设计指南](https://code.visualstudio.com/api/ux-guidelines/webviews) 和 [Webview 主题接口](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content)。

### 安装态复验

Windows VS Code 的 1920×1080 窗口中，以同一个 `hello_world` 工程检查两种布局。中文浅色工作台可视区为 1178×763 CSS 像素，英文深色双编辑组为 590×763 CSS 像素；收起辅助分区时，两者的正文均恰好可见，没有横向或纵向溢出。宽屏应用行中的三个操作合计 273 像素，把 643 像素留给路径。长路径、打开折叠项、放大字号后仍可正常滚动阅读。原型另在 320、390、620、1100、1920 像素宽检查四个页面的文档宽度。

west 与 CMake 各用一个空构建目录。两次都由缺板提示进入搜索，选中 `qemu_cortex_m3`，完成配置并编译出 ELF。已检查 Tab、单选框方向键、外观预览与取消、跨工程保留外观，以及宿主浅色、深色、高对比浅色和高对比深色切换。源码和安装内容已核对。Windows 原生界面为本轮实测平台。

[中文浅色工作台实机截图](installed/build-workbench-zh-0.5.9.png) · [英文双编辑组实机截图](installed/build-workbench-split-en-0.5.9.png)

### 实现边界

`build_page` 负责当前构建页的操作与缺项条目。`build_view_state` 按工作区、应用、开发板、构建目录和构建方式保存展开项与焦点。原型和扩展使用同一组构建控件、命令展示及样式；原型使用示例数据，扩展从真实任务取得参数。任务的构造和执行仍归扩展宿主。

`workbench_appearance` 管理外观对话框的预览、取消和应用。`appearance_settings` 只写入用户选择的外观字段。外观变更可以在没有工程时使用，也不需要触发设备树、模块或工具扫描。原型将偏好保存在浏览器内。

## 0.5.4 安装验收

| 场景 | 在 VS Code 中观察到的结果 |
| --- | --- |
| Windows 中文，已有构建目录 | 打开后停在工作区，顶部顺序为构建、工作区、工程配置、模块。工作区从 VS Code 进程继承 Zephyr 源码和 SDK 路径，从当前目标缓存读出板名和工具链，并标出各自来源。 |
| CMake，已有缓存 | 使用本机 Zephyr 4.5.0-rc1 的 `hello_world`，为 `qemu_cortex_m3` 生成 ELF。应用 `CMAKE_BUILD_TYPE=MinSizeRel` 后，构建页仍能同时看到上次的 `Debug`。在扩展内点击「配置」，磁盘缓存与界面均更新为 `MinSizeRel`。 |
| Windows 英文，新构建目录 | 首次配置前可见板名、CMake 的 `-G Ninja`、显式的 `OFF`、`0` 和空字符串。环境与构建两页均提示哪些值已有来源。 |
| west 工作区 | 在独立测试工作区写入 west 的 `build.generator`，界面读出 `Ninja Multi-Config` 和来源，板名对应 `-b`。此项验证配置读取。 |
| 切换应用或构建目录 | 回归覆盖其他应用、开发板、复制和缺少标识的缓存。缓存中的默认板和变量只随对应目标生效。 |

可复查 [1920×1080 工作区截图](installed/variables-environment-0.5.4.png) 和 [1920×1080 构建截图](installed/variables-build-0.5.4.png)。在工程根目录运行 `node --test tests/buildVariables.test.js tests/environmentValues.test.js` 可复验变量识别规则。

**简体中文** | [English](environment-workspace-build.en.md)
