# Thread studio interaction draft

[简体中文](thread-studio-draft.md) | **English**

[Open the offline interactive draft](thread-studio-preview.html?lang=en) · [Two-thread source analysis baseline](thread-analysis.en.md)

## Start with a development question

One thread samples a value and another processes it. Choose a message queue to keep each sample's payload, a semaphore to signal that work is available, or a mutex when both threads need exclusive access to shared state. Switch between these designs and trace which values cross the boundary and which operations may wait. [Message queues](https://docs.zephyrproject.org/latest/kernel/services/data_passing/message_queues.html) · [Semaphores](https://docs.zephyrproject.org/latest/kernel/services/synchronization/semaphores.html) · [Mutexes](https://docs.zephyrproject.org/latest/kernel/services/synchronization/mutexes.html)

| Stage | Action | Visible feedback |
| --- | --- | --- |
| Choose a mechanism | Select a component under Program draft | Edges change with the component. Messages and permits flow from the producer through the object to the consumer. Both threads acquire the mutex. |
| Edit a thread or object | Select a node and change its stack size, priority or capacity | Nodes display draft values. The API inspector and files use the same generated data. Invalid input identifies the field and disables export. |
| Check a project | Export a new sample, configure and build it, then scan the selected application under Source analysis | Threads, calls, objects and diagnostics point to source lines. Coverage describes the files scanned. The draft and scanned project have independent origins. |
| Inspect a stop | Under Paused stack, select the session, pause and read threads, frames and scopes | A stop supplies the stack and variables. If the adapter reports CPU cores, retain their names. Resuming clears old values. |

## Four checks for the draft

1. Change message queue depth from 4 to 8. Compare the object, API and C declaration. Change one thread's stack and priority and check that the other thread retains its own values.
2. Select the mutex and follow both edges to the calls that acquire the same lock. Repeat in a narrow editor or with the keyboard.
3. Compare thread entries and ordinary calls under Source analysis. Find the source for each item and identify the limits of the scan.
4. Try the labeled simulated stop and resume in the offline draft. In the extension, read an actual stopped stack. Switch sessions or resume and verify that old frames disappear.

The workbench groups the three tasks on one page. Relations and parameters sit below the task selector. Nodes and API controls are keyboard-accessible. At narrow widths nodes, edges and labels change to a vertical flow. The offline draft provides example analysis, simulated debugging and an export preview. The installed workbench uses the local application and debugger.

The three mechanisms and both creation modes were checked. The static form shows the stack and priority in `K_THREAD_DEFINE`. The runtime form shows the thread object, stack, entry, priority and start delay in `k_thread_create`. Browser checks covered keyboard navigation, following a queue from its consumer to its producer and clearing previous frames after resume. Both languages passed interaction checks at 320, 720 and 1280 pixels. Additional checks covered 1920×1080, dark mode and system forced colors. [1920×1080 prototype screenshot](thread-studio-1080p.png)

[简体中文](thread-studio-draft.md) | **English**
