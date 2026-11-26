# Features, interaction and boundaries of the independent extension

[简体中文](interaction.md) | **English**


[Current acceptance review](review/README.en.md) · [Design overview](README.en.md) · [Try the prototype](index.html) · [Tool environment diagram](environment.svg)

[Native pickers, manual paths and workspace discovery](review/local-selection.en.md)

## Configuration graph interactions

The application is the root. Branches show containment, such as Kconfig menus containing symbols or devicetree buses containing peripherals. Double-click a node to see its effective value, available choices and destination file in place. Application file changes first enter a draft. Save the current file's draft as a copy or review the diff and write back to the project. Drag empty canvas space to pan. Ctrl + wheel zooms at the pointer, with equivalent keyboard and button controls. Show known inputs before first configuration. Add the Zephyr-generated menu and hardware hierarchy after successful configuration. [Implementation and acceptance](review/configuration-modules.en.md)

## How an application becomes a build target

Start from an application containing `CMakeLists.txt`. The application, board target, build directory, Zephyr source, toolchain and, where applicable, sysbuild image define the operation's context. A west workspace is optional. The workbench shows the boards, qualifiers, build targets and runners discovered by the current tools, with their sources next to them. Distinguish what is known before first configuration from what the previous build recorded.

| Object | Preferred evidence | Location in the UI |
| --- | --- | --- |
| Applications, samples, boards and CPUs | Local application files, board discovery from the selected Zephyr checkout, configured CMake cache | Build Target. Fuzzy pickers show a manual `BOARD` value's source alongside the effective value. |
| Software configuration | Effective fragments, Kconfig menus and evaluated values for the current image | Software branch. Show definition, type, visibility, dependencies and target fragment. Search symbols and prompt text. |
| Hardware configuration | Board DTS, application overlay, bindings, generated `zephyr.dts` | Device nodes and properties. Show full node path, original value, input file and effective result. Explain read-only properties. |
| External components | Effective west manifest for repository and revision, module metadata, explicit directories and actual build inputs for dependency evidence | Modules distinguishes why an item is needed, its target revision and local status. Mark unresolved conditions as awaiting configuration. |
| Tools and sources | Package discovery by current CMake, `ZEPHYR_BASE`, `ZEPHYR_TOOLCHAIN_VARIANT`, relevant toolchain variables and PATH | Tool Environment. Trace each value to its source and scope. Browse for existing tools, SDK directories or applicable local packages. |
| Images, flashing and debugging | Current build directory, image information, generated runner metadata and available targets | Open from the relevant build result. Other projects in the workspace have their own execution contexts. |

Component order, tool names and CPU qualifiers vary by Zephyr version. Discovery follows the selected checkout. Example manifest revisions are demonstration data. When selecting a board, module selection uses its project's declarations and build evidence. For example, evaluate `cmsis_6` and `cmsis` separately. Offline, compare local HEAD with a locally resolvable target. For floating references, show the remote check time or “Not checked”. [Zephyr modules](https://docs.zephyrproject.org/latest/develop/modules.html) · [west manifests](https://docs.zephyrproject.org/latest/develop/west/manifest.html)

## Actions and feedback

| User action | Immediate response | Implementation requirements |
| --- | --- | --- |
| Open an empty folder | Build offers Select Local Application and Start from Sample. | Discover inputs first. List relative paths for multiple applications. Allow CMake configuration without west. |
| Select another board or build directory | Show the full target and source nearby. Mark existing results as requiring reconfiguration. | Prefer a separate directory. Verify the application and board before reusing a cache. Require explicit confirmation to clean a directory. |
| Change build method | Update the command preview and preserve inputs. | Separate west and CMake argument generation and availability checks. Preserve manually entered text, show conflicts and identify the adopted value. |
| Search or double-click a graph node | Open its configuration control beside the node with the current value and destination file. The keyboard can enter from the same node. | Support panning, zooming, focus and a detached window. Large graphs initially show the selection and nearby nodes and expand on demand. Select controls appropriate to real types. |
| Create, read, update or delete Kconfig settings | Search symbols, select a fragment, stage an assignment or remove the explicit assignment from that fragment. | Kconfig reevaluates after deletion on the next configure. Setting n and removing an assignment have distinct semantics. Explain visibility and dependency constraints. |
| Edit a device property | Inspect type and binding first. Changes appear in the target overlay diff. | Generate binding-compatible syntax. Show generated DTS as an output. Provide source locations for complex phandles, arrays or unknown types until reliable editors support writing them. |
| Save, undo or edit across windows | All views show the draft diff, change count and target file. Save by file after confirmation. | Scope sessions by application, build, image and file. The backend owns the baseline and revision and checks both disk and editor buffers. On conflict, preserve the draft and offer a fresh comparison. Indicate unsaved files before exit. |
| Configure, build or run | Identify the command and directory. Show output and cancellation while running and navigate to diagnostics after failure. | Pass argument arrays and working directory, then read artifacts after success. Offer flash, debug and erase based on target capabilities and verify the target before connecting to hardware. |
| Sync one or more modules | Each row shows revision, source, status and progress. Refresh affected rows on completion. | Use west configuration and manifest. Check local changes and support retrying failed modules individually. On network failure retain local state and last check time. |
| Change a tool source | In the same row, select discovery, a local path or a supported package, then verify version, platform and architecture. | The user initiates network installations. Show the scope of each change. User-level global settings require explicit selection. |
| Open guidance | Show the purpose, actual files and commands and official references beside the operation. | Long tutorials share a bilingual help entry. Release screenshots and pointer-guided demos use 1920 × 1080. Use localization keys for all production UI text. |

[Zephyr Kconfig settings](https://docs.zephyrproject.org/latest/build/kconfig/setting.html) · [Devicetree operations](https://docs.zephyrproject.org/latest/build/dts/howtos.html) · [Build, flash and debug](https://docs.zephyrproject.org/latest/develop/west/build-flash-debug.html)

## Responsive layout decisions

Navigation order is Build, Workspace, Project Configuration, Modules. First launch opens Workspace, as do the old `#tools` link and `#workspace`. Each page uses a single column of functional sections. Environment Setup is at the top of Workspace and remains available without west. Optional west information follows below and has a direct navigation entry. VS Code manages the native debug sidebar.

| Scenario | Behavior to verify |
| --- | --- |
| Desktop and widescreen | Widen lists, paths, graph and inspector. Stack inputs, actions and results vertically. |
| Narrow editor | Wrap controls to available width, retain text links to all four pages and keep full paths and commands readable. |
| High zoom or expanded terminal | Scroll the page vertically. Long lists scroll independently and hand scrolling back to the page at the boundary. |
| Large-screen configuration | Graph above, inspector below. Zoom and drag affect the canvas. Review the draft before confirming a write to the project. |

## Module boundaries in the independent project

The independent `zephyr_extension` design calls for its own extension ID, commands, localization resources, storage and license notices. Interfaces follow Zephyr project objects. The first release builds on the VS Code extension API, selected Zephyr source and official tool interfaces. Record the origin and license of each third-party dependency. The earlier extension's commands, assets, private configuration and implementation are outside this dependency set.

| Boundary | Inputs and outputs | Responsibility |
| --- | --- | --- |
| Project discovery | Workspace directory, environment and user selection → application, board and tool candidates with sources | Platform paths, scanning and cache invalidation, all read-only. |
| Build execution | Explicit application, board, build directory and arguments → task, diagnostics and artifact index | west and CMake each generate their own arguments. Use VS Code Task, Terminal, Problems and Debug. |
| Configuration editing | Target file, baseline and user action → diff, revision and save result | Parse Kconfig and devicetree separately. Share drafts across views. Check target and conflicts before writing. |
| Module management | Manifest, dependency evidence and local repositories → selection reasons, revisions and sync plan | Separate network checks, downloads and updates from read-only discovery. |
| Interface | Typed snapshots and operation results → workbench and inspectors | Share navigation, list, status and graph controls. File writes and command launch belong to the host. |

**First project acceptance case.** Build the same local application using CMake and west. Select the same board, stage one Kconfig change and one overlay change, reconfigure and compare actual artifacts. A second case removes west and configures a standalone application with an installed SDK and CMake package. Follow up with multi-image builds, non-ASCII paths, offline modules, save conflicts and real runners. Enable product actions based on those results.

## Prototype verification

The historical five-page prototype was tested on Windows Edge at editor widths of 1920, 1024, 768, 600, 420 and 360 px. All 30 combinations of Environment Setup, West Workspace, Build, Configuration Graph and Modules had no horizontal page overflow. Interactions included command switching, fuzzy board selection, invalidating old results, saving and discarding drafts, synchronizing detached windows, panning, candidate search, single selection, batch sync and local tool paths. Design text and graphics remain vector-based. PNGs were captured directly at 1920 × 1080.

Production acceptance separately covers native VS Code detached windows, screen readers, platform probes, official configuration evaluation, real disk conflicts and hardware operations. Build, Sync and Save in the prototype demonstrate state transitions.

## Review from a new machine to a device

| Stage | Try in the prototype | Acceptance in the real extension |
| --- | --- | --- |
| Host preparation | Workspace → Environment Setup → New Machine → Prepare Installation Plan. Try Windows and Linux. | Check Git, Python, CMake, Ninja, DTC and other tools against checkout requirements. Support package managers or manual downloads and show install scope and affected directories. |
| Python isolation | Switch to Python Environment and open setup and preparation instructions for venv, packages and west. | Bind pip to the same interpreter. Use a version-compatible wheelhouse or explicitly enabled online installation. Check required packages and versions, then test imports. pip check alone cannot establish completeness. |
| Sources and toolchain | Configure local Zephyr, choose SDK or cross-compile and inspect effective paths. | Read the source version and CMake package. Verify the target compiler, architecture and actual executable version. After selecting board and CPU, use the recommended local SDK compiler, override it for this application and board, or browse to an external GNU executable. After configure, display the compiler recorded by CMake. |
| Workspace management | Open or initialize → local/remote manifest → preview command → manage manifest and modules. | Discover existing topdir, manifest.path and manifest.file read-only. Local west init -l creates .west alongside the manifest repository. Remote init accepts URL, revision and target root. List affected projects, caches and dirty repositories before updating. |
| Application and project arguments | Project Settings → create from sample or import → choose board and directory → set arguments or override tools. | Each application may use a different tool environment. Preserve argument text and show scope in the configure command after leaving settings. |
| Graphical editing | Select Kconfig or devicetree → edit → draft → diff → save → reconfigure. | Isolate reads and writes, support undo and verify effective values by running the official build. Test cross-window conflicts, complex properties, constrained symbols and BOARD changes separately. |
| Build, flash and debug | After building, open Flash and Debug to inspect images, runners and execution plan. | Read real artifacts and targets supported by the board. Identify device and image and show results in VS Code Debug/Terminal. Without real hardware the design only previews operations. |
| Testing and diagnostics | Open Tests to inspect Twister's test roots and platform plan. | Build the matrix from real test definitions. Distinguish missing hardware, unavailable execution, failure and cancellation. Provide logs and reruns. |
| Offline operation and recovery | Enable offline mode and try remote initialization or syncing missing modules. Specify an unknown path and verify. | Name the missing package or Git object and preserve sources and local changes. After restoring the source or correcting the path, retry only the failed step. |

The installation plan uses example tools and versions for review. The prototype covers project scope, tool sources, missing requirements and task plans. The product needs native integration for installation, authentication, directory browsing, serial port/probe detection and system package changes. The prototype's Chinese UI was used for this review. Verify both Chinese and English in the production UI and tutorials.

[Zephyr getting started](https://docs.zephyrproject.org/latest/develop/getting_started/index.html) · [west workspaces](https://docs.zephyrproject.org/latest/develop/west/workspaces.html) · [west initialization and updates](https://docs.zephyrproject.org/latest/develop/west/built-in.html)

## Build methods, process variables and module acquisition

The top bar identifies the active build method. west drives Zephyr's CMake build. CMake configures from the application, board and build directory. Both can use existing local resources. Network policy determines whether requests are permitted. Before running west offline, the production extension must confirm that the required objects, tools and dependencies are available. Workspace initialization, manifest project updates and compilation should each show their steps, versions and results.

Build Process Environment in Workspace lists each process variable's current value and source. When it matches the target cache, show “Matches build cache”. When values differ, show both. A cache-only variable reads “Unset in process”. Expand commonly used variables missing in both places to see them. Label temporarily adopted discovery results separately from confirmed workspace settings.

Build Variables and the command preview use the same configuration inputs. Show `BOARD`, generator, user definitions and module arguments first. Expand additional variables as needed. Edits update the requested value immediately. Update the matching cache after successful configuration. Recheck cache ownership when changing build directory, application or board. The prototype records example configuration in memory. The extension reads the target's `CMakeCache.txt`.

| Module source | Prototype interaction | Product behavior |
| --- | --- | --- |
| Current workspace west module | Filter and select from the effective manifest. Show the association action when unlinked. Workspace can read an exported YAML manifest for this workspace. | Preserve manifest revision, path and source. Isolate by workspace. |
| Online module | Search official Zephyr organization repositories, select one and identify revision and metadata in place. | Validate origin by organization ownership, revision by commit and module identity by declaration. |
| Personal online module | Paste a GitHub/Gitee repository home, tree or blob link, or an HTTPS/SSH address. Override revision and checkout destination. | Map the page to repository, branch or tag and module subdirectory. Read that revision's metadata and display the evidence and inspected commit. |
| Local module | Enter a directory or browse to identify its name automatically. | Reference the existing checkout. Skip local repositories during batch sync. |

Candidates share one search box. Names filter the local list by default. Search Online queries official repositories. Input contents distinguish repository links and local paths. Remote target revision, checkout directory and identification results appear in the list. The beginner guide covers entry file rules and troubleshooting.

CMake explicitly sets local module directories using `ZEPHYR_MODULES`. west discovers workspace modules automatically and adds extra local directories via `EXTRA_ZEPHYR_MODULES`. The prototype's `<project root>` placeholder shows the path resolution base. The product must resolve it to an absolute directory and pass it as a single argument. Offline YAML reading uses js-yaml 4.1.1 bundled with the prototype. [MIT notice](vendor/js-yaml/LICENSE) · [Zephyr module discovery](https://docs.zephyrproject.org/latest/develop/modules.html) · [west manifest format](https://docs.zephyrproject.org/latest/develop/west/manifest.html)

## Large-screen configuration window and source recognition

- Full-screen Configuration moves the current graph to a full-screen native work window. Exiting returns it to the original editor group. For a second monitor, Open Configuration in New Window allows moving and resizing freely. Search and canvas tools remain at the top. Application, board/CPU, Kconfig, devicetree and draft inspectors expand from the bottom. Window transfers retain editing state.
- Applications support selection, import, build directories and additional arguments. Boards support qualifiers and reading the CMake cache. Kconfig supports search, adding, editing and removing explicit assignments, and importing fragments. Drafts are isolated by current application and board and saved to the demo project in the browser. Real definitions, dependency evaluation and disk writes use the production build backend.
- URLs and directories share module naming rules, preferring the declared name and displaying the evidence file. Missing entry points, malformed files and inaccessible revisions prevent confirmation. Editing the address, directory or revision invalidates the old result. The preview service listens only on loopback and reads a local module entry or temporarily fetches the requested Git revision. Offline mode accepts local identification only.

## Module revision and synchronization decisions

| Field | Meaning | Effect |
| --- | --- | --- |
| Project requirement | Revision in the west manifest or specified when explicitly adding the module. May be SHA, tag, branch or HEAD. | Preserve the declaration. For floating references, show the known or newly resolved SHA separately. |
| Local checkout | Commit of the current worktree. Distinguish missing downloads from unknown state. | The product reads HEAD from that repository. The prototype records a simulated checkout. |
| Target for this sync | Concrete SHA to check out for each module. | Defaults to the project requirement. Optionally check a remote branch explicitly and use the SHA resolved at check time for this simulated sync. |

A branch tip differing from the project revision establishes a difference in commits. Compatibility, ancestry and containment need independent evidence. Resolve each module separately in a batch and disable confirmation while any target is unknown. Targets verified in the sample cache can be restored offline. A permanent upgrade should produce a separate manifest revision change for review. Real execution must also check dirty worktrees, local branches, Git object availability and per-repository results after failure. The demo updates in-memory state only.

## Debugging alongside project configuration

Use the editor for source code or project configuration. Run and Debug on the left keeps the active session's threads, stack frames, variables, watches and breakpoints. The Zephyr view adds application, board target, build directory, default runner and configuration files that can be opened. Users can move native VS Code views. Source files and debug configurations share the native editor. A detached configuration window keeps the full canvas. Stepping in the browser is a demonstration. The native extension starts an existing workspace debug configuration through VS Code.

## Environment page layout

Tool groups sit above the configuration area. The selected group and the build process environment stack vertically, showing variable name, full value and source in order. Paths wrap to available width. The VS Code Activity Bar Z icon controls the sidebar. The standalone browser preview has its own toggle.

[简体中文](interaction.md) | **English**
