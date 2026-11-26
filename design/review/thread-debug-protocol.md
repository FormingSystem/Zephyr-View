# 线程调试视图的暂停协议

**简体中文** | [English](thread-debug-protocol.en.md)

在「线程工作室」的暂停视图中选择当前工作区的调试会话。Cortex-Debug 可通过 GDB 服务器接入目标；服务器的 RTOS 感知能力决定枚举结果。适配器可能只返回一个 CPU。列表保留调试器给出的名称，开发者可以与 VS Code 原生调用堆栈核对。每个结果属于所选会话，与草稿线程之间不会按名称自动绑定。[Cortex-Debug](https://github.com/Marus/cortex-debug)

## 从暂停读到数值

| 交互 | 请求与依据 | 边界 |
| --- | --- | --- |
| 在 VS Code 中启动或选中调试会话 | 工作室复用当前工作区的会话，显示会话名和适配器类型；多会话时可切换 | 会话已经启动但未观察到停止时，等待下次暂停。切换工程后仅列出对应工作区的会话 |
| 命中断点后读取线程 | 收到 `stopped` 后，点「读取线程」向适配器请求 `threads` | 全部暂停可展开所有线程；单线程停止只允许展开确认暂停的线程。其余线程仅显示名称 |
| 选择暂停的线程 | `stackTrace` 按适配器给出的栈序，显示函数、源文件和行号；首帧是栈顶 | 只展示前 32 帧。优化和缺失调试符号可能使源码位置为空 |
| 选择帧和作用域看输入值 | 选帧请求 `scopes`，再单击作用域请求一层 `variables`，保留名称、类型及值 | 每次最多展示 64 项。昂贵作用域需要显式选择；惰性子项保留占位，不触发求值。不进行表达式求值、写变量、读外设内存或自动追踪对象树 |
| 继续、单步或结束会话 | 已显示的帧和变量标识失效；迟到的读请求不回填 | 部分线程恢复运行时，能从协议确认仍暂停的其他线程可重新读取。恢复时与下一次断点的数值属于不同快照 |

## 宿主接口与验证

宿主在扩展激活时注册 VS Code 的调试跟踪器；工作台读取工作区快照并传回代表当前选择的令牌。每次读取只接受上一级结果已经列出的线程、帧或作用域。适配器报告的错误在当前快照内可见，重新读取可以重试。它与构建图共用应用上下文，源码调用关系、RTOS 调度事件和断点时刻栈分别展示。[VS Code 调试跟踪器](https://code.visualstudio.com/api/references/vscode-api#DebugAdapterTracker) · [调试协议](https://microsoft.github.io/debug-adapter-protocol/specification)

验收时用标准调试会话暂停在应用函数，比较栈顶和一个局部变量，再单步确认旧值立即清除。协议测试还应涵盖只返回 CPU、跨工作区同名会话、单线程恢复、会话结束以及请求晚于下一次暂停才返回。

## 用本机 QEMU 对照一次断点

1. 从工作室导出消息队列示例，以 `mps2/an386` 为目标、`build` 为目录完成构建。安装适用于宿主机的 ARM GDB 与 QEMU，确认 Cortex-Debug 能找到工具链的 GDB、objdump 和 nm。用 VS Code 打开这个示例目录。
2. 在示例根目录启动模拟器。它加载 ELF，在复位处等待调试器，调试端口只监听本机：

   ```sh
   qemu-system-arm -machine mps2-an386 -cpu cortex-m4 -display none -monitor none -serial none -S -gdb tcp:127.0.0.1:3333 -kernel build/zephyr/zephyr.elf
   ```

3. 在 VS Code 的 `launch.json` 增加下列配置。如果实际 ELF 位于别处，改 `executable`。将 `ZEPHYR_VIEW_TEST_ARM_BIN` 设为 SDK 编译器的 `bin` 目录并让 VS Code 继承它。这个变量仅用于下面的示例配置。也可在 Cortex-Debug 已有的工具链设置中指定目录。

   ```json
   {
     "name": "Zephyr message queue (QEMU)",
     "type": "cortex-debug",
     "request": "launch",
     "servertype": "external",
     "cwd": "${workspaceFolder}",
     "executable": "${workspaceFolder}/build/zephyr/zephyr.elf",
     "toolchainPath": "${env:ZEPHYR_VIEW_TEST_ARM_BIN}",
     "toolchainPrefix": "arm-zephyr-eabi",
     "gdbTarget": "127.0.0.1:3333",
     "overrideLaunchCommands": ["set confirm off"],
     "runToEntryPoint": "consumer_entry"
   }
   ```

4. 在 `src/main.c` 的成功接收分支中，给打印 `received %u` 的行加断点。启动该配置，在入口停止后继续到打印行。点工作室的「读取线程」，选择适配器上下文、栈顶和 `Local`，与 VS Code 原生调试面板对照。继续运行，帧与变量应立即清除。退出调试后结束自行启动的模拟器进程。

**实测结果。** Windows 11 上，Cortex-Debug 1.12.1 与 QEMU 的 GDB 服务停在消费者打印行。适配器报告一个名为 `CPU#0 [running]` 的上下文；其 `stopped` 事件允许读取栈。栈顶是 `consumer_entry`，下一帧是 `z_thread_entry`，`Local` 中读取到 `value = 42`、`err = 0`。继续后状态回到运行中，旧数据被清除。这次验证使用模拟器；多线程枚举的效果仍取决于实物探针及 GDB 服务器的 RTOS 支持。

**简体中文** | [English](thread-debug-protocol.en.md)
