# Zephyr View design and feature reviews

[简体中文](README.md) | **English**

Open **Programming Studio** in Zephyr View to connect threads, functions and signals, edit their behavior, and replay values from firmware. [Walkthrough and 1080p animation](../../extension/guides/visual-program.en.md)

[Source UML class diagram design and acceptance](source-class-diagram.en.md) · [UML modeling and renderer selection](uml-modeling.en.md)

[0.5.28 program designer design and acceptance](program-designer-details.en.md) · [Connect, move and inspect steps in the installed extension](../../extension/guides/media/program-authoring.gif)

[Visual programming design and requirements audit](visual-development-audit.en.md) · [Open the interactive designer](visual-program.html?lang=en&example=firmware)

[Engineering analysis design: application entry points, threads, functions and data flow](thread-analysis.en.md) · [Interactive two-thread example](thread-analysis-preview.html?lang=en)

[Thread studio interaction draft](thread-studio-draft.en.md) · [Detailed design and acceptance matrix](thread-studio.en.md) · [Debug adapter verification](thread-debug-protocol.en.md)

[Beginner workflows, layout and module responsibilities](onboarding.en.md)

[0.5.17 missing-component setup guide, platform support and VSIX relocation checks](platform-support.en.md)

[0.5.16 workbench review and verification: component installation, probe drivers, firmware flashing and page responsibilities](installation-and-flashing.en.md)

[Installed extension user guide](../../extension/README.en.md) · [Interactive prototype](../index.html#workspace) · [Current release and version](../../README.en.md) · [Local selection and discovery](local-selection.en.md)

This review started with the Build page, evaluating each module before implementation. For the next modules, see the [workspace, configuration graph, modules and debug sidebar review](module-refinement.en.md) for reproduction steps, existing features and acceptance criteria.

For board/compiler matching, manual overrides, out-of-tree board directories and native build results, see [target compiler verification](environment-workspace-build.en.md#0510-target-compiler).

## Finding your way around the workbench

| Entry | What you see first | What you can do next | Layout rationale |
| --- | --- | --- | --- |
| Build | Application, board and CPU, build directory and build variables | Select a target in place, compare requested arguments with the previous cache, configure, build and inspect generated files. | Identify what will be compiled and which changes still need configuration. |
| Workspace (first open) | Current directory, build method and environment setup | Inspect the sources of tools, checkout, toolchain and process variables. For west, find the workspace and manifest further down the same page. | Keep the project’s environment in one place, including for standalone CMake applications. |
| Project configuration | Current target and configuration graph | Select an object, edit in the inspector below the graph, compare the draft, save, then reconfigure to verify its effect. | The graph identifies the object and the inspector has the full width for editing. Focus mode and a separate window share the same project context. |
| Modules | Selected modules, with candidates and search below | Choose a workspace manifest, official online search, personal Git URL or local directory. Review the revision, then sync one module or a batch. | The workspace manifest describes available repositories. Application and board dependencies need separate evidence. Compare required revision, local checkout and proposed sync target from top to bottom. |
| VS Code debug target sidebar | Application, board, build directory, runner and session | Choose a launch configuration and use native debugging to inspect variables, breakpoints and call stacks. | The editor, terminal and debug sidebar resize independently. The central page avoids a duplicate sidebar toggle. |

**Workspace** in the UI is the setup page for the current VS Code project. A **west workspace** is the specific workspace with a `.west/config`. The extension saves environment overrides in the corresponding VS Code workspace scope. When switching applications, keep this scope distinct from per-application settings. Zephyr documents its application build and west workspace models separately. Combining these controls on one vertically arranged page is a product design decision. [Zephyr application development](https://docs.zephyrproject.org/latest/develop/application/index.html) · [West workspaces](https://docs.zephyrproject.org/latest/develop/west/workspaces.html)

0.5.4 verified environment sources, build cache and values after reconfiguration in English and Chinese VS Code on Windows. [Installation results and two native screenshots](environment-workspace-build.en.md#054-installation-acceptance)

0.5.5 verified build-method selection, configure/build readiness, actions for every detected missing prerequisite, and proportional form widths in split editors. [Layout and native tests](workbench-debug.en.md#configuration-panel-width-and-build-entry-points)

0.5.6 checked automatic board devicetree selection, automatic application overlays and how both inputs appear in project configuration. [Devicetree verification](configuration-modules.en.md#056-board-devicetree-and-optional-overlays)

0.5.7 placed the actual DTS below the board selector and added Kconfig entry points to Build and the sidebar. [Board selection and configuration entry points](configuration-modules.en.md#057-board-selection-and-configuration-entry-points)

## Manual review of 50 features

0.5.15 verified target discovery, architecture, project defaults, multi-file merging and sysbuild against Zephyr’s rules. [Compatibility checklist and scope](standard-adaptation.en.md)

0.5.14 added automatic build-input discovery, candidate search, a system file picker and ordered merging. The default parallel job count comes from the host, independently of the board CPU selection. [Cross-architecture builds and reset tests](multi-board-build.en.md) · [Windows VS Code screenshot](installed/configuration-inputs-0.5.14.png)

Each ID corresponds to a row in a subject review with design rationale, current behavior and repeatable checks. The checkboxes are for reviewers. Record the ID, OS and language, Zephyr version, west or CMake, input project and observed result. For a failure, include steps to reproduce and the expected result.

- [ ] **ENV-01–06** Tool discovery, Python and west, local source, SDK and cross-compilation, variable sources and scope, online and offline setup. [Environment setup](environment-workspace-build.en.md)
- [ ] **WS-01–05** Directory discovery, effective manifest, workspace initialization, update and disassociation. Repeat with a standalone CMake app and a west workspace. [Workspace](environment-workspace-build.en.md)
- [ ] **BUILD-01–08** Application, board/CPU, build directory, argument precedence, generator, tasks, outputs and multiple images. Compare commands with actual cached values. [Build](environment-workspace-build.en.md)
- [ ] **C01–C08** Configuration graph, inputs and outputs, Kconfig, devicetree, isolated drafts, save and conflicts. Modify a value from an existing file; inspect the disk contents before saving. [Project configuration](configuration-modules.en.md)
- [ ] **M01–M08** Module sources, evidence of identity, reasons for selection, revisions, offline and batch sync. Check both pinned SHAs and moving branches. [Modules](configuration-modules.en.md)
- [ ] **UI-01–10** Workbench entry, vertical layout, keyboard, mouse, narrow window, theme, zoom, graph and tutorials. [Workbench and layout](workbench-debug.en.md)
- [ ] **DBG-01–05** Debug target, shortcuts, association with the build, launching a session and capability limits. [Debugging](workbench-debug.en.md)

### Three acceptance paths

1. **Offline without west.** Open a standalone app, select prepared local Zephyr source, Python and SDK, then select a board, configure and build with CMake. Inspect the task command, generated `.config`, `zephyr.dts` and ELF. Automatic offline provisioning of missing tools and wheels is reviewed separately.
2. **Pinned manifest with newer remote commits.** Compare required revision, local HEAD and intended target. Preview and sync one item. On reopening offline, distinguish a match against a pinned SHA from the time of the last remote branch check. Separately test protection of a module with uncommitted local changes.
3. **Switch boards or applications in one project.** Save custom CMake arguments, switch target, then edit an explicit Kconfig assignment in the graph. Verify that the picker preserved the additional arguments, that old artifacts do not appear in the new target, and that the original file has not changed before Save. Finally compare effective values against Zephyr output after reconfiguration.

## Review priorities

| Priority | Finding | Criteria for closing it |
| --- | --- | --- |
| High | Automatically selecting all required modules still needs traceable evidence. A manifest alone cannot determine whether the application needs legacy cmsis or cmsis_6. | Locate the declarations or build evidence for this checkout, board and configuration. A sample must identify which component requires which module and which revision applies. Switching boards drops stale inferences and preserves manual selections. |
| High | Existing tools can be specified manually. Offline installation, SDK architectures and complete Python dependencies still need an end-to-end path. | Test on Windows and Linux with empty and existing setups, offline and with missing packages. Show discovery evidence, the installer inputs and an actionable next step. |
| High | The graph supports fragment editing. Full Kconfig dependencies and devicetree properties with bindings must come from the current build model. | Compare with menuconfig, final `.config` and generated devicetree. Identify requested and effective values, constraints and source files, and recover from save conflicts. |
| Medium | A fallback west manifest, branch freshness, multiple images, interrupted batches and stale caches after removing a module can make state unclear. | Show scope, last check, domain, per-item result and argument ownership. Test partial failure and retry. |
| Medium | Connecting Activity Bar selection with the central editor and using inline lists entail specific interaction trade-offs. Focus, screen readers, high contrast and private repositories need continuing review. | Complete the action using only the keyboard and return to the original control on cancel. State what was read and use the user’s configured Git credential tools. |

### Supporting material and verification limits

- **Languages, platforms and paths.** The reviewed package included a bilingual guide, command names and partial UI translation. The Modules page and its errors still needed English coverage. Review sample paths, runtime user selections and portable project data separately. The subject reviews distinguish tested Windows results from outstanding Linux checks.
- **Flashing, debugging and tests.** Capabilities depend on the selected build directory, image, runner and launch configuration. Physical flashing and probe debugging require hardware for acceptance. Review Twister test plans and sysbuild domain selection separately. [Zephyr sysbuild](https://docs.zephyrproject.org/latest/build/sysbuild/index.html) · [Zephyr test tools](https://docs.zephyrproject.org/latest/develop/test/twister.html)
- **Layout and tutorials.** The four pages stack sections vertically at all widths. Long paths and commands can wrap. State uses text and color. Tutorial screenshots are 1920×1080 and mouse movements identify specific controls. Installed screenshots: [Workspace](installed/workspace.png), [Build](installed/build.png), [Project configuration](installed/configuration.png), [Modules](installed/modules.png).
- **Prototype, implementation and provenance.** The prototype uses sample data; the VSIX reads the local workspace. The prototype’s initialize action cannot demonstrate a real installation. The workbench is an independent project. When the original review was written, its directory lacked Git metadata, so it could not establish a historical fork commit, and terms for external distribution were pending the owner’s decision. The public repository now uses [Apache-2.0](../../LICENSE); the bundled third-party YAML component has its own [license](../vendor/js-yaml/LICENSE).
- **Keeping records in sync.** Map each change to a feature ID and update the shared design, native host or view, user guide and acceptance row together. Keep previous verification results as history. Record installed UI checks with screenshots separately from code-only checks.

## 0.5.3 installation verification

[Steps, test results and installed screenshots](local-selection.en.md). The verified 0.5.3 VSIX had SHA-256 `92ebbc8d66c9f35f14975f0ca4b7f1eaaa9f2930cb94a44238cbe8820bee0015`.

## 0.5.2 historical installation verification

| Check | Result |
| --- | --- |
| Release VSIX and installation | Tested the final VSIX in an isolated Windows VS Code installation, then installed it in the current user’s VS Code. The extension list reported 0.5.2. Package SHA-256: `6879e89add9b9c68371487887c2fe0c475df953e0cff25de3efefe6bca5e1da3`. |
| Merged entry points | Both languages showed exactly Workspace, Build, Project configuration and Modules. A standalone application without west still had the full environment section. A real west workspace could locate its manifest and config file; Modules read actual entries. [West workspace screenshot](installed/west-workspace.png) |
| Installed layout | Checked all four pages at actual editor widths of 1178, 722, 458 and 298 CSS pixels, for 16 states; none overflowed horizontally. Checked the vertical order of the environment and west sections, build controls, configuration graph and inspector. After navigating to west, switching to Build returned to the top of the new page. All demonstration screenshots were originally 1920×1080. |
| Search and configuration graph | In the installed extension, loaded the next batch of a board list with over 100 entries, fuzzy-searched `mps2an386` and selected `mps2/an386`. At 125% the actual graph width matched the scale indicated when zooming from 100%; reset worked. [Board selection tutorial with pointer](../../extension/media/guide/board-picker.gif) |
| Prototype and legibility | Rechecked 42 prototype viewport/page combinations and tested long English status text. The first-screen host tools panel shrank from 673 px to 413 px. Three main environment variables were readable on the initial 1080p screen. [Prototype layout measurements and before/after data](prototype-layout.en.md) |
| Build, configuration and themes | See the [build review](environment-workspace-build.en.md) for real west and CMake Zephyr builds, generator inheritance, target switching and file scope. The [project configuration review](configuration-modules.en.md) covers fragment regressions. The [workbench review](workbench-debug.en.md) gives text contrast measurements in both themes. |

This round did not perform native Linux tests, debug through a hardware probe or test a private remote repository end to end. The manual review checkboxes remain open.

## Keeping both languages current

Update each `.md` page together with the `.en.md` page in the same directory. After comparing their content item by item, run `python tests/test_bilingual_docs.py --record design/review/README.md`, substituting the path of the Chinese page you reviewed. Run `python tests/test_bilingual_docs.py` to check all pairs, links and anchors.

[简体中文](README.md) | **English**
