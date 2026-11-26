# Reading a paused thread in the debugger

[简体中文](thread-debug-protocol.md) | **English**

Choose a debug session for the current workspace in Thread Studio's paused view. Cortex-Debug can connect through a GDB server. The server's RTOS awareness determines what it can enumerate. An adapter may report a single CPU. The list keeps the adapter's names so you can compare it with the native VS Code Call Stack. Each result belongs to its session. Matching a name to a draft thread would require additional evidence. [Cortex-Debug](https://github.com/Marus/cortex-debug)

## From a breakpoint to a value

| Interaction | Request and evidence | Limits |
| --- | --- | --- |
| Launch or choose a VS Code debug session | The studio lists sessions in this workspace with their names and adapter types. Multiple sessions can be selected individually | An already running session whose stop was never observed must reach another stop. Changing workspace folders changes the session list |
| Read threads at a breakpoint | After a `stopped` event, Read threads sends `threads` to the adapter | An all-stop event enables every thread. With a single-thread stop, only threads confirmed stopped can be expanded; the others show their names |
| Select a stopped thread | `stackTrace` supplies the ordered functions, source files and lines, with the top frame first | Up to 32 frames are shown. Optimization or missing debug symbols may leave source positions empty |
| Select a frame, then a scope | Selecting a frame requests `scopes`; selecting a scope reads one level of `variables` with names, types and values | Shows up to 64 entries per scope. Expensive scopes require an explicit click. Lazy children retain their placeholder. The studio does not evaluate expressions, write variables, access peripheral memory or traverse object trees automatically |
| Resume, step or end the session | Existing frame and variable identifiers expire. Late replies cannot restore old values | After a partial resume, other threads known to remain stopped can be read again. Each breakpoint has its own snapshot |

## Host contract and verification

The host registers a VS Code debug adapter tracker at activation. The workbench reads the snapshot for its workspace folder and sends a selection token back with each request. Thread, frame and scope IDs must have been returned by the previous level. Adapter errors remain visible for the current snapshot and the user can retry. The studio shares application context with the build view and presents static calls, scheduling events and paused stacks as distinct sources. [VS Code debug adapter tracker](https://code.visualstudio.com/api/references/vscode-api#DebugAdapterTracker) · [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/specification)

Verify with an application breakpoint: compare the top frame and a local variable with the debugger, then single-step and check that the old value clears immediately. Protocol tests should also cover CPU-only adapters, similarly named sessions across workspaces, partial continuation, termination and responses arriving after the next stop.

## Compare one breakpoint in local QEMU

1. Export the message-queue example from the studio and build it for `mps2/an386` in `build`. Install ARM GDB and QEMU for your host and check that Cortex-Debug can locate the toolchain's GDB, objdump and nm. Open the exported application folder in VS Code.
2. Start the emulator in that folder. It loads the ELF, waits at reset and binds its debug port to localhost:

   ```sh
   qemu-system-arm -machine mps2-an386 -cpu cortex-m4 -display none -monitor none -serial none -S -gdb tcp:127.0.0.1:3333 -kernel build/zephyr/zephyr.elf
   ```

3. Add this configuration to VS Code's `launch.json`. Adjust `executable` if your ELF is elsewhere. Set `ZEPHYR_VIEW_TEST_ARM_BIN` to the SDK compiler's `bin` directory in the environment inherited by VS Code. This variable belongs only to the example configuration. You can also set the directory in your existing Cortex-Debug toolchain settings.

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

4. In `src/main.c`, set a breakpoint on the successful receive branch's `received %u` print statement. Start the configuration, then continue from the entry to the print statement. Choose Read threads, the adapter context, the top frame and `Local` in the studio; compare with the native VS Code debug panel. Continue and verify that the frames and values clear. Stop the emulator you launched after ending the debug session.

**Observed result.** On Windows 11, Cortex-Debug 1.12.1 and QEMU's GDB server stopped at the consumer's print statement. The adapter reported one context named `CPU#0 [running]`; its `stopped` event authorized reading the stack. The top frame was `consumer_entry`, followed by `z_thread_entry`. The `Local` scope contained `value = 42` and `err = 0`. Continuing returned to the running state and cleared the old values. This test used an emulator. RTOS thread enumeration on hardware depends on the probe and GDB server.

[简体中文](thread-debug-protocol.md) | **English**
