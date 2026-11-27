# UML 建模设计评审

**简体中文** | [English](uml-modeling.en.md)

## 两个入口，两种用途

读已有代码时，在编程工作室的 **UML 类图** 中点成员或类型，跳到对应声明。讨论尚未实现的设计时，从 **UML 建模** 选择图种，创建可编辑的 PlantUML 草图。例如，要讨论采样线程如何把消息交给处理线程，可以选顺序图，写出入队、取队和超时三个步骤。讨论截止时间则用时间图，注明时间单位。[源码类图与定位规则](source-class-diagram.md)

设计文件采用普通 `.puml` 文本，作者可以修改元素和连线、另存、重新打开，或随工程提交 Git。图中的消息和时间由作者填写。源码反向分析目前以有声明依据的类型关系为限。十四种草图的交付范围是图面表达；XMI 模型交换、UML 元模型一致性和由草图生成 C 代码另需独立实现。[OMG UML 2.5.1 规范与交换模型](https://www.omg.org/spec/UML/2.5.1) · [PlantUML 对图形一致性的说明](https://plantuml.com/faq)

## 选型

| 工具 | 作者实际编辑的内容 | 在本扩展中的用途 |
| --- | --- | --- |
| PlantUML（`jebbs.plantuml`） | `.puml` 中的元素、关系和标签。插件按光标处的图预览，也能导出。 | 首选。扩展维护图种目录与起始示例，将渲染委托给可选插件。安装插件前也可以编辑和保存草图。[插件清单](https://github.com/qjebbs/vscode-plantuml/blob/master/package.json) · [PlantUML 图种](https://plantuml.com/) |
| Mermaid | Markdown 的 `mermaid` 代码块，可写流程、类、状态和顺序等图。VS Code 从 1.121 起内置 Markdown 中的 Mermaid 预览。 | 适合把少量图示随 README 或教程发布。其文本语法和预览入口独立于 PlantUML。[VS Code 1.121 说明](https://code.visualstudio.com/updates/v1_121/#_mermaid-diagrams-in-markdown-preview-and-notebooks) · [Mermaid 语法](https://mermaid.js.org/intro/syntax-reference.html) |
| UMLet（`TheUMLetTeam.umlet`） | 在 `.uxf` 画布上摆放图元、拖动连线端点、编辑图元属性；活动图和顺序图提供专用的文本表达。 | 可选的自由布局画布。用户直接新建或打开独立的 UXF，在工程中保留可继续拖动的布局。[UMLet 的 VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=TheUMLetTeam.umlet) · [UMLet 编辑操作](https://www.umlet.com/faq.htm) |

## 自由布局画布

在 **UML 建模 → 自由布局画布（UMLet）** 选择新建或打开。新建时在保存对话框选一个未使用的 `.uxf` 文件名，即得到空白画布。双击右侧面板中的图元将其加入画布，在属性区改名或填写成员，拖动图元调整布局，按系统保存快捷键写回原文件。需要复用已有布局时选择“打开画布”。系统缺少 UMLet 时，可以从提示进入扩展详情页。

适配器通过 `vscode.openWith` 指定上游注册的 `uxfCustoms.umletEditor`。UMLet 自己也提供 `umlet.createNewDiagram`，本扩展使用保存对话框以支持命名和选目录。UXF 保存图元、属性与坐标；PlantUML 草图单独保存为 `.puml`，两条路径各自使用对应的编辑器。[官方编辑器注册及命令](https://github.com/umlet/umlet/blob/master/umlet-vscode/package.json) · [空文件与图元操作](https://github.com/umlet/umlet/blob/master/umlet-vscode/README.md)

## 十四种图该何时选

图种对应开发者想回答的问题。下表最后四项使用有限图形记法，选择时应可见这一范围。其余十项采用 PlantUML 文档中的元素，包括用 `package` 表示包及包依赖。[PlantUML 图种索引](https://plantuml.com/) · [类与包](https://plantuml.com/class-diagram) · [活动与分支](https://plantuml.com/activity-diagram-beta)

| 图种 | Zephyr 工程里的问题 | 应读出的信息 |
| --- | --- | --- |
| 类图 | 哪个类型持有采样数据？ | 类型、成员、关联或组合 |
| 对象图 | 两个传感器实例各自使用哪个队列？ | 实例、属性值、实例间链接 |
| 包图 | 驱动层依赖哪些接口包？ | 包边界和依赖方向 |
| 组件图 | 采集组件向谁提供采样接口？ | 组件、接口和依赖 |
| 部署图 | 哪个处理器运行哪份固件？ | 执行节点与部署的产物 |
| 用例图 | 操作者能让系统执行哪些任务？ | 参与者、系统边界、目标 |
| 活动图 | 采样失败之后重试还是退出？ | 动作、条件和控制流 |
| 状态机图 | 什么事件会让设备从休眠切到运行？ | 状态、事件和迁移 |
| 顺序图 | 哪个线程先入队，哪个线程后取出？ | 参与者和有序消息 |
| 时间图 | 中断到唤醒间隔有多长？ | 时间刻度与状态变化 |
| 组合结构图（有限） | 采集子系统内部的部件怎么连接？ | 用嵌套图元和连线表达部件与连接器 |
| 剖面图（Profile，有限） | 想用哪些领域术语标注线程或设备？ | 用构造型和元类标签表达扩展意图；构造型适用约束由作者核对 |
| 通信图（有限） | 多个对象经哪些路径传递消息？ | 在对象链接上标注消息编号与方向；顺序由作者维护 |
| 交互概览图（有限） | 初始化、采集和恢复三个交互如何串起来？ | 用活动控制流引用命名的交互；引用名称由作者维护 |

## 预览、离线与许可

1. **创建与编辑。** 在图种列表中按名称或用途搜索，选择图种和保存位置，使用尚未占用的文件名创建图稿。需要接着画时，从同一列表打开已有的 `.puml` 或 `.plantuml`。取消保存即返回。普通文本编辑和保存无需 Java、Graphviz 或网络。
2. **可选预览。** 在受信任的工作区，用户发起预览时，将目标图稿置于活动编辑器。插件清单声明语言 ID `plantuml`、后缀 `.puml` 和命令 `plantuml.preview`。插件还提供 `plantuml.exportCurrent`，在其自身界面可将当前图导出。插件不可用时，保留编辑中的文本。[插件命令与语言注册](https://github.com/qjebbs/vscode-plantuml/blob/master/package.json)
3. **离线部署。** 希望全程本地渲染时，在 PlantUML 插件中显式选择 `plantuml.render = Local`，准备 Java 和本地 JAR。类图等布局会用到 Graphviz 的 `dot`；顺序图可用于先验证 Java 路径。Windows 发行包可能已提供所需的 JAR 和 Graphviz，先试实际图种，再补缺项。示例使用随包文本，不引用网络资源。[本地渲染设置](https://github.com/qjebbs/vscode-plantuml#requirements-for-local-render) · [Graphviz 所需图种与自检](https://plantuml.com/graphviz-dot)
4. **服务器渲染。** `PlantUMLServer` 将图稿发往 `plantuml.server` 对应的服务，内容可能包括展开的 include。即使 GET 请求中的图稿已压缩编码，接收方仍然能恢复原文。用户主动选择预览，扩展沿用插件配置；已选服务器渲染时，先确认是否发送图稿。涉及未公开的接口或芯片名称时，选择本地渲染或团队认可的服务器。[服务器渲染](https://github.com/qjebbs/vscode-plantuml#about-render) · [文本编码](https://plantuml.com/text-encoding)
5. **分发。** Zephyr View 维护自己的模板，通过公开命令连接插件。插件源码采用 MIT；PlantUML 引擎有多种许可发行包。若将来随 VSIX 捆绑 JAR、Graphviz 或第三方源码，应按所选制品分别核对许可及随附声明。[插件许可证](https://github.com/qjebbs/vscode-plantuml/blob/master/LICENSE.txt) · [引擎发行版本与许可](https://plantuml.com/download)

## 验收方法

- **创建与保存。** 在未装提供方的 VS Code 中逐一创建十四种草图，修改一个元素或一条消息，保存为 `.puml` 后重开，核对修改仍在。取消保存后检查磁盘，重复创建后检查第一份草图。
- **记法。** 离线渲染十四份样例并检查图中实际文本和方向。检查通信图的编号、组合结构的内外层级、剖面图的构造型和交互概览的分支。成功产生图片只验证语法，还要核对图意。
- **提供方。** 打开两个不同的图稿，从其中一份启动预览，确认预览采用的是它。分别核对提供方缺失、运行时缺失和正常预览时的编辑与恢复路径。
- **工作室。** 在独立窗口和窄编辑组中检查图种名称及有限记法提示，键盘可完成选择。已有源码类图的点击定位与导出仍可单独使用。

### 拖放与保存实测

在单独的 VS Code 配置中从微软市场安装 UMLet 15.1.0，打开包含 `Sampler` 类的 UXF。编辑器标签报告 `uxfCustoms.umletEditor`。鼠标向右拖动 130、向下拖动 80，保存后重新读取磁盘 XML，坐标从 `(140,160)` 变为 `(270,240)`，宽高仍为 `140 × 80`，`read()` 成员仍在。验证覆盖本地 Windows 桌面编辑器。

**简体中文** | [English](uml-modeling.en.md)
