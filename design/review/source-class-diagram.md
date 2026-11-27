# 源码 UML 类图

**简体中文** | [English](source-class-diagram.en.md)

## 阅读任务

打开编程工作室，选择工程源码中的一个 C 或 C++ 文件，再进入 **UML 类图**。图与右侧源码共用当前编辑缓冲区。优先解决三个问题：这个类型声明在哪里，它把哪些对象放在自身存储中，它通过哪些成员访问其他类型。

| 源码证据 | 图上的表达 | 点击定位 |
| --- | --- | --- |
| 命名的结构体、联合体、枚举或类定义 | 标有声明种类和成员的类型框 | 定义行或成员行 |
| 类型已在本文件定义，按值声明为成员 | 所属类型一端画实心菱形 | 成员声明 |
| 指针或 C++ 引用指向可解析的类型 | 有向关联线 | 指针或引用声明 |
| C++ 定义显式列出可解析的基类 | 空心三角指向基类 | 继承声明 |

## 接口和取舍

宿主从当前文件已预处理的词法标记构建节点和关系。每条关系携带端点、关系种类、标签、条件状态和一行源码证据。视图与导出共用这个模型。跨文件关系使用当前源文件直接包含的头文件。只有能定位到唯一类型定义时才连线。条件状态来自现有扫描器。正在编辑且语法尚未闭合时，保留最近一次有效图，等新版本解析成功再开放定位和导出。

内置图适合离线浏览、键盘选取和源码跟行。需要与设计工具交换时，用户选择保存为 `.puml`。安装了 PlantUML 插件的用户可以主动选择使用它的预览命令，渲染方式沿用该插件自己的设置。[UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/About-UML) · [PlantUML 类图语法](https://plantuml.com/class-diagram) · [VS Code PlantUML 插件](https://marketplace.visualstudio.com/items?itemName=jebbs.plantuml)

## 直接引用的头文件

点击关系定位到当前文件中的成员声明；点击目标类型打开右侧的头文件定义。返回按钮恢复原文件，图仍围绕原文件展开。打开的头文件优先采用编辑缓冲区，修改后重新解析。条件不确定、同名冲突、宏生成的文件名及间接包含保留为成员文字。

引号引用先从当前文件所在目录解析，再按当前翻译单元的编译参数解析搜索目录。常见 Zephyr 公共头文件也可从当前选定源码树的 `include` 定位。回归覆盖同级源码树、未保存缓冲区及导出前依赖发生变化。[GCC 头文件搜索路径](https://gcc.gnu.org/onlinedocs/cpp/Search-Path.html) · [Clang 编译数据库](https://clang.llvm.org/docs/JSONCompilationDatabase.html)

## 验收

同一文件中验证按值成员、指针、显式继承及它们的源码行。检查重复名字、条件分支、回调声明、未完成输入和空图。验证主题切换、窄窗、键盘、保存取消及保存过程中源码变化。最后在 1920×1080 的真实独立窗口中，使用 Zephyr 源文件定位至少一条类型关系。

### 跨头文件定位实测

在下述 Zephyr 提交的 `sd.h` 中验证了四种成员：`sdhc` 的指针目标、`bus_io` 和 `host_props` 的按值类型，以及 `card_voltage` 的枚举。在中文 VS Code 独立窗口中点击 `host_props` 到达 `sd.h:68`，点击类型到达 `sdhc.h:230`，点击 `f_max` 到达 `sdhc.h:231`。返回后恢复第 68 行，明暗主题均通过。[跨头文件实拍](../../extension/guides/media/uml-header-navigation.png)

### 单文件基线

在 Zephyr 提交 `25c8f4a23988` 上扫描了 `include/zephyr` 内 2255 个头文件。2245 个通过文件读取和语法检查，1000 个产生类型图。7 个超过现有 256 KiB 限制，3 个保留为未完整解析。这次扫描核对了所有关系端点存在，语义抽查使用 SD 卡与内核线程头文件。

在真实 VS Code 独立窗口点击 `sdio_func.card`，右侧定位到 `sd.h` 第 50 行。点击反方向的 `sd_card.func0`，定位到第 82 行。明暗主题均按 1920×1080 核验。导出同一份类型模型后，用 PlantUML 2.18.1 扩展附带的本地渲染器生成 SVG，并在隔离的 VS Code 配置中打开了该扩展的预览。[SD 卡源码](https://github.com/zephyrproject-rtos/zephyr/blob/25c8f4a23988dd3b2cfb463613622738298c2d6c/include/zephyr/sd/sd.h) · [工作室实拍](../../extension/guides/media/uml-class-diagram.png)

**简体中文** | [English](source-class-diagram.en.md)
