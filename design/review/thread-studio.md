# 线程工作室：详细设计与验收

**简体中文** | [English](thread-studio.en.md)

工程选型、源码关系和断点观测各回答一个问题：我要在线程之间传什么？现有工程在哪里做了这件事？这次停下来的执行上下文里实际是什么值？工作台「线程」页把三者放在同一个工程上下文中，每个视图都标明信息的来源。[交互初稿](thread-studio-draft.md) · [打开可操作的设计稿](thread-studio-preview.html) · [新手操作手册](../../extension/guides/threads.md)

## 选型怎样转成工程

以下三种练习均含两个任务。选中线程修改的是其申请的栈字节数和调度优先级；选中中间的内核对象修改的是对象参数。对同一个草稿，图的数值、C 预览和导出的工程都从同一份模型生成。[模型与代码生成](../../extension/media/threadStudio/model.js)

| 开发者手中的问题 | 选型与 API | 输入、输出和可验证的含义 |
| --- | --- | --- |
| 采样任务给处理任务发送一个 32 位数值 | 消息队列，`K_MSGQ_DEFINE`、`k_msgq_put/get` | 生产者传入 `&value`，队列按 `sizeof(uint32_t)` 复制内容，接收成功时写入消费者自己的变量。容量 4 改为 8 后，同一队列最多多缓存四条消息。接收路径打印 `received 42`。[官方消息队列](https://docs.zephyrproject.org/latest/kernel/services/data_passing/message_queues.html) |
| 一项工作已准备好，接收方只需取得一次许可 | 计数信号量，`K_SEM_DEFINE`、`k_sem_give/take` | 初始许可数为 0，给出一次许可后消费者可以取得它。上限为 1 时，多次未被取走的通知可合并。图中的连线没有数据载荷。成功路径打印 `permit acquired`。[官方信号量](https://docs.zephyrproject.org/latest/kernel/services/synchronization/semaphores.html) |
| 两个任务修改同一个计数，必须保护读、改、写 | 互斥锁，`K_MUTEX_DEFINE`、`k_mutex_lock/unlock` | 两个任务分别取同一把锁、递增计数，并把值复制到局部变量后解锁。计数最终为 2。输出顺序取决于调度；本次默认优先级下先看到 A 的 1，再看到 B 的 2。[官方互斥量](https://docs.zephyrproject.org/latest/kernel/services/synchronization/mutexes.html) |

需要在线程间转交调用者管理的数据块时，可进一步考虑 FIFO 及其对象生命周期；需要表示多个条件位时可考虑事件；需要把中断后续处理转交线程时可考虑工作队列。当前图形生成器提供上表三种可构建练习。已有工程中的 `K_FIFO_DEFINE`、`K_EVENT_DEFINE`、`K_WORK_DEFINE` 等声明可在源码视图发现。后续扩充模板时，应为每个新类型同时定义数据所有权、运行上下文、超时行为与可复查的输出。[FIFO](https://docs.zephyrproject.org/latest/kernel/services/data_passing/fifos.html) · [事件](https://docs.zephyrproject.org/latest/kernel/services/synchronization/events.html) · [工作队列](https://docs.zephyrproject.org/latest/kernel/services/threads/workqueue.html)

### 创建方式、数值和保存

- 静态创建为每个任务生成 `K_THREAD_DEFINE`，注册位置可独立于 `main()`。运行时创建在 `main()` 中调用 `k_thread_create`，保留两个任务各自持久的 `struct k_thread` 和栈对象。切换创建方式可对照 C 声明、入口实参与启动位置。[Zephyr 线程](https://docs.zephyrproject.org/latest/kernel/services/threads/index.html)
- 练习工程配置了八档可抢占优先级，允许 0–7，数值越小优先级越高。两个任务可同优先级。栈输入范围为每线程 512–4096 字节、8 字节的整数倍，容量范围为 1–64。这些是本练习的参数边界；实际板的 RAM、架构对齐、MPU、日志或函数调用深度均会影响栈的选择。界面显示申请量，测量实际占用需另行采集。
- 输入非法数值会显示对应字段并暂时禁用导出。核对生成的 `src/main.c`、`prj.conf` 和 `CMakeLists.txt`，选一个可写父目录，工作室在其中创建独立工程。已有同名目录时可以换位置，工程中原有 C 文件和 Kconfig 输入保留。重新导出前，原副本中的手工修改需要由开发者自行比较。[导出和源码定位](../../extension/threadStudioHost.js)

## 证据与组件边界

| 组件 | 提供的事实 | 不确定情形和界面反馈 |
| --- | --- | --- |
| [工程范围](../../extension/threadAnalysis.js) | 已匹配的构建目录有有效 `compile_commands.json` 时，只分析其中属于应用的 C/C++ 翻译单元。缺数据库时在应用根递归寻找源码，跳过生成目录、识别到的嵌套独立应用和链接目录 | 编译数据库记录输入文件，不能证明某行在该配置下生效或其符号保留在 ELF。空的有效数据库返回零个文件；损坏或不可读时可回退到源码候选并提示覆盖范围。文件跳过、扫描或结果截断会标记部分结果 |
| [源码索引](../../extension/threadSource.js) | 展示 `main`、静态注册、运行时创建、对象声明、函数及直接调用点的实参拼写。保留文件、行、函数作用域、条件标记和本次扫描的定位标识 | 仅对能证明的常量 0/1 预处理分支作取舍，其他分支作为条件候选；不展开任意用户宏、头文件、函数指针或数据流。跨文件同名/不可唯一定位时停止展开。源码变更或重扫后需重新定位 |
| [运行时适配](../../extension/threadDebug.js) | 读取所选调试会话本次暂停的 `threads → stackTrace → scopes → variables`，保留适配器原名、栈帧顺序和可读值 | 同一函数可出现在多个线程。没有可靠身份关联时，草稿线程与调试器上下文分别显示。继续执行、切换会话或结束调试会使旧值失效。无 RTOS 感知时可能只枚举 CPU。[暂停协议与复现方法](thread-debug-protocol.md) |

选中一个线程后，先看它的注册行，再展开入口函数的直接调用。两个线程共用辅助函数时，可以分别回到各自调用位置看不同实参。源码页展示候选路径；想知道某一刻真实的调用顺序、优化后仍可见的形参或局部值，需要带符号的 ELF 和兼容的调试器。调度时间轴、全程序数据竞争、栈峰值与死锁证明仍需要各自独立的证据。

### 静态诊断和处理方法

| 诊断 | 产生提示的直接证据 | 如何复核、调整 |
| --- | --- | --- |
| ISR 使用互斥量 | 同一文件内明确绑定的 ISR、直接 ISR 或定时器到期回调里出现 mutex lock/unlock | 在诊断行核对回调注册，若共享操作需要互斥，可考虑提交工作项，让线程完成受保护的访问 |
| ISR 使用可能等待的超时 | 上述上下文向已识别的等待 API 传入不明确等价于 `K_NO_WAIT` 的表达式 | 确认宏展开和 API 的 ISR 约束。合法的带括号或注释的 `K_NO_WAIT` 可识别；自定义零超时表达式需要人工核对 |
| 工作处理函数可能无限等待 | 普通或延时工作处理函数中，已识别的等待操作使用 `K_FOREVER` | 检查该工作的提交队列、超时返回值、负责唤醒的运行上下文以及同队列后续工作 |
| 持锁期间可能无限等待 | 相邻语句为获取同一互斥锁、以 `K_FOREVER` 等待另一对象、释放该锁 | 查看唤醒者是否也需这把锁。可考虑缩短持锁范围并重新检查竞态。分支、别名或中间函数调用缺乏此规则所需的直线证据 |

## 独立验收矩阵

| 复查任务 | 操作与判据 | 本轮结果 |
| --- | --- | --- |
| 比较六个可导出的工程 | 对三种组件分别使用两种创建方式。用无 west 的构建 Python、标准 CMake/Ninja、匹配的本地 Cortex-M 模块和 SDK 编译，检查串口 | Windows 11、Zephyr `25c8f4a23988`、SDK 1.0.1、QEMU `mps2/an386` 上六次均生成 ELF；两种方式的输出分别与上方队列、许可及计数示例一致 |
| 将数值追到源码 | 改容量、栈、优先级，对比生成文件、入口行、注册行、API 实参及对象；尝试空白、小数、越界和未对齐的数值 | 测试覆盖边界、拒绝无效导出及浏览器和宿主的生成一致性。源码索引重新读取全部六个工程时，入口、对象、调用和行号对应。[生成模型测试](../../tests/threadStudioModel.test.js) |
| 阅读陌生的现有工程 | 扫描 Zephyr 的 `samples/synchronization`，从两个线程找到各自的创建依据 | 在上述源码版本分别定位到静态 B（97 行）、`main`（102 行）、动态 A（104 行）及两个信号量。三个已配置的默认练习均通过真实编译数据库只读到本应用源文件 |
| 验证诊断的边界 | 比较中断回调与普通函数、定时器到期与停止回调、`K_FOREVER` 与 `K_NO_WAIT`、存在/不存在持锁等待；混入条件分支、假注释、相邻工程与目录链接 | 正反例、畸形数据库、文件大小/记录数上限、重扫后拒绝旧位置均有回归测试。[源码诊断与隔离测试](../../tests/threadAnalysis.test.js) |
| 对照一次真实暂停 | 在消息队列消费者打印行暂停，比较原生调试器和线程视图，继续后检查旧值 | Cortex-Debug 1.12.1 + QEMU 报告一个 CPU 上下文。栈顶为 `consumer_entry`、下一帧 `z_thread_entry`，得到 `value = 42`、`err = 0`。此结果未覆盖物理探针枚举多个 RTOS 线程。[调试实测记录](thread-debug-protocol.md) · [安装版断点截图](installed/thread-studio-debug-1080p.png) |

## 在本地复跑六种固件

在仓库根目录运行下面的命令。准备 Node、CMake、Ninja、已安装 Zephyr 构建依赖的 Python 和 ARM QEMU。按本机工具链设置 `ZEPHYR_BASE`，使用 Zephyr SDK 时可用 `ZEPHYR_SDK_INSTALL_DIR` 指定位置。默认从 PATH 查找 `qemu-system-arm`。[固件验证工具](../../tests/native/thread_firmware.py)

```sh
python tests/native/thread_firmware.py
```

要验证完全离线的构建，请使用未安装 west 的 Python，传入本地模块和模拟器的位置。这里以本次验证所用的 CMSIS_6 为例。其他 Zephyr 版本所需的模块取决于其清单，可重复传入 `--module`。

```sh
python tests/native/thread_firmware.py --require-no-west --module "<CMSIS_6 目录>" --qemu "<ARM QEMU 可执行文件>"
```

工具在临时目录中生成六个独立工程，逐个编译并读取模拟器串口。成功时会分别列出六次观察结果。互斥锁示例允许任一线程先运行，两条记录须来自不同线程，并分别含有计数 1 和 2。

**简体中文** | [English](thread-studio.en.md)
