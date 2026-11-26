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

[简体中文](program-designer-details.md) | **English**
