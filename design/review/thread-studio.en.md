# Thread studio design and acceptance tests

[简体中文](thread-studio.md) | **English**

Designing a program, reading its source and stopping in the debugger answer three different questions. What should pass between tasks? Where does this application implement it? What value does this execution context hold at this stop? The workbench **Threads** page keeps the same project context across all three and identifies the source of each answer. [Interaction draft](thread-studio-draft.en.md) · [Interactive prototype](thread-studio-preview.html?lang=en) · [Hands-on guide](../../extension/guides/threads.en.md)

## From a choice to a Zephyr application

Each exercise uses two tasks. Select a task to change its requested stack size in bytes or scheduling priority. Select the kernel object between them to edit its parameters. The diagram, C preview and exported project all use the same model. [Model and code generation](../../extension/media/threadStudio/model.js)

| Developer's problem | Component and APIs | Inputs, outputs and what to check |
| --- | --- | --- |
| A sampling task sends a 32-bit value to a processing task | Message queue, `K_MSGQ_DEFINE`, `k_msgq_put/get` | The producer passes `&value`. Zephyr copies `sizeof(uint32_t)` bytes and a successful receive writes to the consumer's own variable. Increasing capacity from 4 to 8 adds room for four buffered samples. The success path prints `received 42`. [Message queues](https://docs.zephyrproject.org/latest/kernel/services/data_passing/message_queues.html) |
| Work is ready and the receiver needs permission to proceed | Counting semaphore, `K_SEM_DEFINE`, `k_sem_give/take` | The initial count is zero. One give makes a permit available to a consumer. With a limit of one, outstanding notifications can coalesce. The diagram's edge has no payload. A successful take prints `permit acquired`. [Semaphores](https://docs.zephyrproject.org/latest/kernel/services/synchronization/semaphores.html) |
| Two tasks update the same counter and must protect the read, increment and write | Mutex, `K_MUTEX_DEFINE`, `k_mutex_lock/unlock` | Each task acquires the same lock, increments the counter, copies its value locally and unlocks. The final count is two. Print order depends on scheduling. The default priorities in this run produced A with 1 and B with 2. [Mutexes](https://docs.zephyrproject.org/latest/kernel/services/synchronization/mutexes.html) |

For handing off caller-managed data blocks, consider a FIFO and the lifetime of its elements. Events can represent multiple condition bits. A workqueue can defer processing from an interrupt to a thread. The generator supplies the three buildable exercises in the table. The source view also recognizes declarations such as `K_FIFO_DEFINE`, `K_EVENT_DEFINE` and `K_WORK_DEFINE` in existing applications. Any additional generator template should define ownership, execution context, timeout behavior and an observable result. [FIFOs](https://docs.zephyrproject.org/latest/kernel/services/data_passing/fifos.html) · [Events](https://docs.zephyrproject.org/latest/kernel/services/synchronization/events.html) · [Workqueues](https://docs.zephyrproject.org/latest/kernel/services/threads/workqueue.html)

### Creation, parameters and saving

- Static creation emits `K_THREAD_DEFINE` for each task. Its registration can exist independently of `main()`. Runtime creation calls `k_thread_create` in `main()` with persistent `struct k_thread` and stack storage for each task. Switch modes to compare the declarations, entry arguments and start sites. [Zephyr threads](https://docs.zephyrproject.org/latest/kernel/services/threads/index.html)
- The lab configures eight preemptible priorities, 0–7. Lower numbers have higher priority and both tasks may share one. The exercise accepts 512–4096 requested stack bytes per thread in multiples of eight, and capacities of 1–64. These are exercise constraints. Board RAM, architecture alignment, the MPU, logging and call depth all influence a production stack allocation. The figure shows the requested size. Measuring actual usage takes a separate observation.
- Invalid input identifies the field and disables export. Inspect `src/main.c`, `prj.conf` and `CMakeLists.txt`, then choose a writable parent directory. The studio creates a new project there. Choose another location if the child directory already exists. Prior C edits and Kconfig inputs remain in their original project. Compare any hand edits in an earlier copy before adopting a new export. [Export and source navigation](../../extension/threadStudioHost.js)

## Evidence and component boundaries

| Component | What it establishes | Uncertainty and feedback |
| --- | --- | --- |
| [Project scope](../../extension/threadAnalysis.js) | Given a matching build and valid `compile_commands.json`, scan application translation units selected by that database. Otherwise discover sources below the selected app, skipping generated trees, recognizable nested applications and linked directories | Database membership establishes a build input. It cannot establish that a particular line is active or a symbol survived linking. A valid empty database yields zero files. An invalid or unreadable database allows a source-candidate fallback with coverage information. Skipped files and scan or result limits mark partial coverage |
| [Source index](../../extension/threadSource.js) | Locate `main`, static thread registrations, runtime creation, object declarations and functions. Direct call sites retain their argument expressions, file, line, function scope, conditional marker and a navigation ID specific to that scan | Only simple constant 0/1 preprocessor branches are resolved. Other alternatives remain conditional candidates. General user macros, headers, function pointers and data flow are outside the lexical index. Ambiguous cross-file names stop expansion. Edited source or a new scan requires a fresh location |
| [Runtime adapter](../../extension/threadDebug.js) | Read `threads → stackTrace → scopes → variables` for the selected debug session and stop. Preserve the adapter's names, frame order and readable values | The same function can run on several threads. Without matching identity evidence, draft threads and debugger contexts remain separate. Resume, session switches and termination invalidate old values. A server without RTOS awareness may enumerate a single CPU. [Suspension protocol and reproduction](thread-debug-protocol.en.md) |

Select an entry to see its registration line and then explore its function's direct calls. When threads share a helper, revisit each call site to inspect its actual arguments. The source view reports candidate paths. Inspect a symbol-bearing ELF with a compatible debugger to see the actual frame sequence and surviving argument or local values at a particular stop. Scheduling timelines, whole-program race detection, stack high-water marks and proof of deadlock each require additional evidence.

### Static diagnostics and how to investigate them

| Finding | Direct evidence used | Developer action |
| --- | --- | --- |
| Mutex operation in an interrupt | Mutex lock or unlock appears inside a directly bound ISR, a direct ISR definition or a timer expiry callback in the same file | Check the callback registration at the reported source. If updating shared state requires a mutex, consider deferring that work to a thread |
| A timeout in interrupt context | One of the recognized wait APIs receives an expression that the scanner cannot establish as `K_NO_WAIT` in one of those callbacks | Inspect the expanded expression and the API's ISR constraints. Parenthesized or commented `K_NO_WAIT` is recognized. A custom expression equivalent to zero timeout needs review |
| A work handler may wait indefinitely | A recognized wait operation uses `K_FOREVER` inside a regular or delayable work handler | Check which queue receives the item, the timeout return behavior, the context that signals it and other work pending on that queue |
| An indefinite wait while holding a mutex | Adjacent statements lock a mutex, wait on another object with `K_FOREVER`, then unlock that same mutex | Check whether the task satisfying the wait needs the same lock. Consider shortening the critical section and rechecking for races. Branches, aliases or intervening function calls lack the straight-line evidence this rule requires |

## Independent acceptance matrix

| Task | Procedure and criterion | Recorded result |
| --- | --- | --- |
| Compare six exported projects | Build each primitive with both creation modes using CMake/Ninja, a build Python without west, the matching local Cortex-M module and the SDK. Read the serial output | Windows 11, Zephyr `25c8f4a23988`, SDK 1.0.1 and QEMU `mps2/an386` produced six linked ELFs. Both creation modes produced the queue, permit and counter results in the selection table |
| Follow a number to its source | Change capacity, stack and priority. Check the files, entry and registration lines, API arguments and objects. Try empty, fractional, out-of-range and unaligned values | Tests cover boundaries, rejected exports and equivalent generation in browser and host. Re-reading all six exercises matches their entries, objects, calls and source lines. [Generator tests](../../tests/threadStudioModel.test.js) |
| Read an unfamiliar application | Scan Zephyr's `samples/synchronization` and find the creation evidence for both threads | This revision identifies static thread B at line 97, `main` at line 102, runtime-created thread A at line 104 and both semaphores. The real compilation databases of the three default builds select only the corresponding application source |
| Exercise positive and negative diagnostic cases | Compare ISR with ordinary function, timer expiry with stop callback, `K_FOREVER` with `K_NO_WAIT`, and code with and without a wait inside a critical section. Include branches, comments, neighboring apps and directory links | Regression tests cover both directions, malformed databases, size and record limits, and rejection of obsolete source IDs after rescanning. [Source and isolation tests](../../tests/threadAnalysis.test.js) |
| Correlate a real pause | Break on the queue consumer's print statement, compare the native debugger with the studio and resume | Cortex-Debug 1.12.1 and QEMU reported one CPU context. The first frame was `consumer_entry`, followed by `z_thread_entry`; `value = 42` and `err = 0` were visible. Physical probes enumerating multiple RTOS threads remain outside this check. [Debug evidence](thread-debug-protocol.en.md) · [Breakpoint in the installed extension](installed/thread-studio-debug-1080p.png) |

## Reproduce the six firmware runs

From the repository root, use Node, CMake, Ninja, a Python environment with Zephyr's build dependencies, and ARM QEMU. Set `ZEPHYR_BASE` for the source tree. With the Zephyr SDK, set `ZEPHYR_SDK_INSTALL_DIR` if needed. The default emulator is `qemu-system-arm` on PATH. [Firmware verifier](../../tests/native/thread_firmware.py)

```sh
python tests/native/thread_firmware.py
```

To check an offline build, use a Python environment without west and pass the local module and emulator paths. This example uses the CMSIS_6 module from the tested revision. Check your Zephyr manifest for the modules your version needs and repeat `--module` for each.

```sh
python tests/native/thread_firmware.py --require-no-west --module "<CMSIS_6 directory>" --qemu "<ARM QEMU executable>"
```

The verifier generates six independent projects in a temporary directory, builds each one and reads its QEMU serial output. A successful run lists six observations. Either mutex worker can run first. Both workers must appear and report distinct counter values of 1 and 2.

[简体中文](thread-studio.md) | **English**
