# Project analysis: follow threads, functions and data from an application entry point

[简体中文](thread-analysis.md) | **English**

Design proposal for review against Zephyr Extension 0.5.18. A developer opening an unfamiliar project needs to find its tasks, learn what starts each one, and see what it waits for and where its results go. Add a read-only **Project analysis** view to the workbench. Start with task relationships for the selected build image. Open a task to explore its functions and, when debugging, inspect its stack at a particular stop. [Try the interactive example](thread-analysis-preview.html?lang=en)

## Walk through a real example

In Zephyr v4.2.0's `samples/synchronization`, following `main()` reveals the creation and explicit start of thread A. Thread B comes from a static `K_THREAD_DEFINE` declaration. Following ordinary function calls from `main()` alone would miss B. The overview must therefore include both the application entry and independently registered execution contexts. [Sample source](https://github.com/zephyrproject-rtos/zephyr/blob/v4.2.0/samples/synchronization/src/main.c#L71-L127) · [Zephyr system threads](https://docs.zephyrproject.org/latest/kernel/services/threads/system_threads.html)

| Selection | What the view shows | Question it answers |
| --- | --- | --- |
| Application entry `main()` | A is created with `K_FOREVER`. A later `k_thread_start` makes it eligible to run. Follow a separate link to B's static declaration. | When can A be scheduled? Where does B come from? |
| Thread A | Its entry calls `hello_loop`, which takes `thread_a_sem`, calls `printk` and eventually gives `thread_b_sem`. | What does A wait for? What does it do, and how can B then proceed? |
| Thread B | It calls the same `hello_loop` with the two semaphore arguments in the opposite order. | Why do the inputs and outputs of the same function differ between tasks? |
| Object `thread_b_sem` | Initial count 0, limit 1. Show A's give and B's take, with the corresponding call sites and thread entries. | The semaphore hands over permission to proceed. The greeting text goes to the console. |

Both threads link to one function definition. Keep the argument bindings and expansion state for each task when switching views. Source explains the handoff. Identifying the CPU that printed a particular line or the time of a wakeup requires evidence from that run. [Shared function and call sites](https://github.com/zephyrproject-rtos/zephyr/blob/v4.2.0/samples/synchronization/src/main.c#L36-L99) · [Official sample and expected output](https://docs.zephyrproject.org/latest/samples/synchronization/README.html)

## Navigation in VS Code

| Level | Initial view | Actions |
| --- | --- | --- |
| Project overview | Reuse the selected application, board and image. Show the application entry, discovered threads and objects shared between tasks. Collapse kernel initialization, system threads and driver internals. | Open a thread. Select a semaphore or queue to list its producers, consumers or waiters. Search by name and locate the result with the keyboard. |
| One thread | Entry point, creation or registration site, start condition, immediate callees, inputs, outputs and operations that can block. | Expand one level. Double-click or use the keyboard to open the call site or definition. Follow callers in reverse. Returning to the overview restores focus. |
| Function or object | Show signature, arguments at the selected call site, return value, object reads and writes, source file and line beneath the diagram. | Follow an output to another thread that uses the object. List multiple call sites. Link back to shared functions and recursive calls. |
| Debugger stopped | Identify the session, image, selected thread and stop. List actual frames in the adapter's order. | Follow the native VS Code Call Stack and source selection. Expand available variables on demand. On resume, mark the snapshot as historical. |

Keep the existing debug target and VS Code debug views in the sidebar. Stack the graph and inspector vertically in the editor. At narrow widths present the relationships as an actionable list. Detaching to a larger screen preserves the image, task and selection. Keep **Locate selected node**, **Fit to window** and **Back** visible. Support panning on empty space, Ctrl + wheel and keyboard zoom. Label edges with verbs and show evidence status in text across light, dark and high-contrast themes.

## What each source can establish

| Evidence | What it can show | Limits and fallback |
| --- | --- | --- |
| Image compilation database, generated headers and semantic C/C++ analysis | Translation units included in the build, macro expansion sites, resolved direct calls, arguments and registered objects. Keep the original spelling location and call site. | Linking can discard compiled code. Report coverage and parsing failures. Without build inputs, label results as source candidates and keep source browsing available. For indirect calls show supported candidates with their assignments, or mark the destination unknown. |
| Zephyr API contracts and actual object bindings | Thread creation and start, submitting and handling work, semaphore give/take, message queue put/get and provable reads or writes. | A timed take/get can wait. Connect all operations that use the same queue object and preserve every endpoint in a many-to-many relationship. Identifying the recipient of one message requires runtime evidence. |
| Symbols and debug information from the selected ELF | Confirm a symbol and address in the image or resolve an observed frame to source. | Inlining, optimization and stripped symbols can leave gaps. A symbol's presence alone cannot establish execution. |
| A stopped VS Code debug session and DAP `threads`, `stackTrace`, `scopes`, `variables` | Threads, frames and available variables the adapter reports for this stop. | Some probes expose only cores or one context. Preserve adapter names. Show an unmapped context when its Zephyr thread cannot be established. Matching names alone are insufficient. |
| Existing Zephyr Tracing or Thread Analyzer output | Timestamped scheduling, wait and wakeup events, or stack usage observed at a particular time. | Distinguish declared capacity, a static estimate and an observed high-water mark. Show gaps in a trace. Thread Analyzer usage statistics cannot reconstruct a call chain. |

Record type and data direction separately. `const T *` constrains access through that pointer. Establish direction using API contracts, actual reads or writes and traceable arguments. For example, the buffer passed to `k_msgq_put` supplies a message, and a successful `k_msgq_get` writes the receive buffer. A semaphore conveys permission. Show an error return and an output buffer separately. Without a debug snapshot show the expression and type, reserving actual values for the debugger. [Message queues](https://docs.zephyrproject.org/latest/kernel/services/data_passing/message_queues.html) · [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/overview)

Record the execution context of interrupts, timers and workqueues. An ISR can submit a `k_work` item whose handler runs in a workqueue thread. Keep the submitter, work item, handler and registration site connected. Opening the handler should identify the queue that executes it. Several items can share a handler. [Zephyr workqueues](https://docs.zephyrproject.org/latest/kernel/services/threads/workqueue.html)

## Integration with the extension

1. **Identify the target.** Reuse the workspace application, build directory and image. In a normal build, read that build's directory. Under sysbuild, enumerate `domains.yaml` and read the selected image's compilation database, configuration and ELF. Use the same entry for west and CMake. Isolate the previous image's data immediately when switching. [Target reader](../../extension/target.js) · [Image enumeration](../../extension/sysbuild.js)
2. **Collect static evidence.** Read each file's working directory, definitions, include paths, language and compiler arguments from the image's `compile_commands.json`. A local C/C++ analyzer can produce semantic nodes on demand and retain macro invocation sites. Use existing VS Code call hierarchy providers for navigation, marking results as build-specific only when the build context can be verified. Report affected files and recovery actions for incompatible versions, missing generated headers or missing databases. Offer an explicit CMake configure action to export compile commands when needed. [Clang compilation database](https://clang.llvm.org/docs/JSONCompilationDatabase.html) · [VS Code call hierarchy commands](https://code.visualstudio.com/api/references/commands)
3. **Relate source to threads.** Distinguish functions by image and symbol, retaining the scope of file-local symbols. Store the actual-to-formal argument binding at each call site. Model declarations, creation sites and runtime instances separately: a creation site inside a loop can produce many instances. Each edge carries its kind, condition, source range and evidence. List unresolved alias candidates. Expand only the selected path to keep recursion and common libraries manageable.
4. **Attach runtime evidence.** A separate debug adapter layer associates the session, stop, thread, frame and matching image. For trace files capture time base, CPU, dropped events and image identity. Show separate CPU timelines when their clocks cannot be aligned. Use available Zephyr stack-analysis targets, Thread Analyzer and Tracing outputs appropriate for the project version. Offline source analysis requires neither a target connection nor firmware instrumentation. [Existing debug entry](../../extension/extension.js) · [Zephyr build analysis tools](https://docs.zephyrproject.org/latest/develop/optimizations/tools.html) · [Thread Analyzer](https://docs.zephyrproject.org/latest/services/debugging/thread-analyzer.html) · [Tracing](https://docs.zephyrproject.org/latest/services/tracing/index.html)
5. **Separate graph data from presentation.** The configuration tree has one parent per node. Calls and communication can have multiple parents and cycles. Keep an independent graph model and reuse pan, zoom, focus and window transfer. The extension host resolves an indexed source reference to a URI and line. Index in cancellable batches: show application and thread entries first, then load driver and kernel details on demand. Discard stale requests on rebuild or target change. Invalidate the per-image cache when flags, source or included headers change. [Graph viewport](../configuration-tree.js) · [Window management](../../extension/configurationWindow.js)

## Delivery and acceptance criteria

| Stage | Independently reviewable behavior | Projects and failure cases |
| --- | --- | --- |
| First: offline project analysis | Entry points, static and dynamic threads, direct calls, semaphores and message queues, per-call inputs and outputs, and source navigation. Move between overview and task. | Use `hello_world` for a simple entry, the synchronization example for argument reversal and a two-consumer queue for multiple endpoints. Repeat on two architectures, with west and CMake, and paths containing spaces and Chinese characters. Exercise recursion, function pointers, multiline wrapper macros and duplicate static function names. |
| Second: stack at a debug stop | Pick a session, thread and frame, open the source, expand available variables, and expire frame references on resume. | Compare adapters that enumerate RTOS threads with adapters that report CPU cores. Match frame order against the native Call Stack. Check optimized-out variables, switching sessions and disconnection. Distinguish same-named functions in separate sysbuild images. |
| Later: asynchronous work and timelines | Link ISRs, workqueues and recorded events to source relationships. Show stack observations when available. | Submit an item in an ISR and handle it in a thread. Truncate a capture to check that gaps remain visible. With tracing disabled, retain the available offline and debugger views. |

Before implementing the project index, use the example to check whether a reader can locate B's startup declaration, trace A's semaphore back to B's give site, and see how both threads share a function while waiting on different objects. Each answer should be visible in the graph and its linked source.

[简体中文](thread-analysis.md) | **English**
