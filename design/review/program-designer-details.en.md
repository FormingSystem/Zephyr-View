# Program designer detail design and review

[简体中文](program-designer-details.md) | **English**

The baseline is Zephyr View 0.5.27 at `3bff9bb`. The reference application sends samples from one thread, receives them in a processing thread that calls a shared function, and wakes a display thread. The interactive design, extension and tests use the same program graph and generator.

| Action | Interaction and data contract | Acceptance check |
| --- | --- | --- |
| Connect two nodes | Choose a context or object in the library. Use the source and destination on the canvas to select the operation. The inspector displays the object, direction and Zephyr call. Cancel before confirming. | Queue to processing thread means receive. The reverse direction means send. An invalid pairing gives specific feedback. |
| Move an instruction | Choose an instruction, destination context, block and position. Move its entire subtree in one document edit and retain step IDs. | Move an instruction into an else branch or another thread. A recursive call, excessive size or a destination inside the subtree leaves the original graph intact. |
| Review concurrency | Starting at main and each thread, follow reachable functions and find the operations that use each object. Show findings, reasons, related steps and remediation. Only structural errors block generation. | A wait on an initially empty queue with no reachable sender leads to its operation. An unused function is excluded. Shared functions retain their callers. |
| Replay firmware | Distinguish the executing context, defining step, data and permits. Canvas and source navigate to the same record. Preserve unknowns when a capture lacks evidence. | Distinguish two threads executing the same function. Verify the selected branch and source against a recorded decision. |
| Update an exported project | Offer a native VS Code diff of the saved C source and the proposed generation at the update entry point. Preview is read-only. Before writing, check document version, ownership, unsaved changes and disk contents again. | Cancelling preview leaves the project intact. A stale confirmation cannot replace intervening graph or source edits. |

Zephyr message queues copy fixed-size data. Semaphores exchange permits. Analysis must account for initial state, wait mode and reachable operations. A possible endpoint alone does not demonstrate execution. Timing, hardware behavior and actual execution order require independent evidence. [Zephyr message queues](https://docs.zephyrproject.org/latest/kernel/services/data_passing/message_queues.html) · [Zephyr semaphores](https://docs.zephyrproject.org/latest/kernel/services/synchronization/semaphores.html)

## Findings and acceptance results

| Reproduced behavior | Change and evidence |
| --- | --- |
| Starting a connection at a queue left the operation unclear. Moving a step into a branch required reconstructing it. | Connecting `samples` to `relay` in the installed extension previews `k_msgq_get`. Moving an existing print into else preserved its ID in the saved design. Removing or changing a populated branch shows the number of descendants it will discard. |
| A receiver could wait forever on an empty queue and its peers were difficult to locate. | Selecting the object lists its accesses, defining functions and reachable threads. In a QEMU boundary test a thread outside the graph sent `99` and woke the receiver. A missing sender in the graph is a lead for investigation. |
| Function input and output shared a record and the return arrow pointed toward the callee. | The bundled QEMU capture contains 18 events. The entry to `scale` records `42` and the return to the caller records `84`. Firmware exercises also covered two threads sharing a function, driver return values and tracing disabled. The older 17-event capture retains its original evidence and source mapping. |
| It was difficult to check proposed C against existing project source before updating. | In the installed extension a native VS Code diff showed the initial sample changing from `42` to `91`. Returning to the graph left the source byte-for-byte intact. Approving the change generated `91`. Changing the graph to `77` during review invalidated the approval and allowed an immediate new review. A hand-edited source can be compared before exporting a separate copy. |

The same design was built with offline CMake and run under QEMU on Arm `mps2/an386` and RISC-V `qemu_riscv32` using Zephyr `25c8f4a23988` and SDK 1.0.1. The two independent captures matched on all 18 events by thread and step, including queue send and receive at `42` and function return at `84`. To reproduce, select either target and build the design with `ZV_TRACE=ON`. [Sample design](../../extension/examples/visual-program/graph.json) · [Expected console capture](../../extension/examples/visual-program/console.txt)

[Interactive exercise and mouse walkthrough](../../extension/guides/visual-program.en.md)

[简体中文](program-designer-details.md) | **English**
