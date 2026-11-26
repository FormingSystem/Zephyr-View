# Interactive prototype layout measurements

[简体中文](prototype-layout.md) | **English**


Windows Chrome loaded the [workbench prototype](../index.html) HTML, scripts and styles directly from the project. Tests switched features with page buttons and measured the browser's actual layout. Tools, project files and module versions used sample data. All screenshots have a 1920×1080 page viewport.

## Build method and variable values

The local preview was opened in Windows Edge. The top bar lists Build, Workspace, Project Configuration and Modules. First launch, `#workspace` and the old `#tools` route all open Workspace. `#build` opens Build. Neither Build nor Workspace showed horizontal document overflow at viewport widths of 1920, 1024, 768, 420 or 360 px.

Workspace checks covered a cache-only `BOARD` value and an automatically discovered path's temporary source and saved workspace source. Build checks covered `BOOL=OFF`, `0`, an empty string and an argument with an equals sign in its value. After changing a Boolean from `OFF` to `ON`, the page showed the requested and last cached values together. Selecting a new build directory hid the previous value. Switching to another application in the same directory produced a cache ownership warning. Switching back restored the original application's arguments. These interactions used browser sample data.

## Navigation and vertical layout

| Check | Action and result |
| --- | --- |
| Four top-level pages | Clicked Workspace, Build, Project Configuration and Modules. Each opened the correspondingly named page with only its own item highlighted. |
| Previous Tools URL | Opening `#tools` directly or navigating there from Build displayed Workspace and highlighted its entry. Existing URLs remain usable. |
| Merged Workspace | Environment Setup is above West Workspace. Host tools, build-process environment, preparation, validation record, workspace information and actions follow vertically. Each field uses the full column, with name, status, purpose and source on the first line and its value below. |
| Build and configuration | Target, inputs, project actions, results and commands appear in order on Build. Project Configuration shows the graph followed by the inspector. Panels align on wide and narrow screens. |
| Module list | Selected items appear above searchable candidates. Download on a row opens that module's sync preview. In dark mode, adding mbedtls and choosing Sync Selected opened a dialog containing both cmsis_6 and mbedtls. |
| Revision selection | The row preview defaults to the project requirement and lists requirement, local checkout and proposed target in order. Latest Branch exposes branch input and Check Online. Confirmation is disabled until a target commit resolves. This run did not download a remote repository. |

In a wide viewport the workspace panel started at 354 CSS px and measured 1507 CSS px across, with the simulated debugging sidebar at its left. At 390 px, the same panel started at 14 CSS px and measured 347 CSS px across. [Workspace](prototype-workspace-1080p.png) · [Module sync dialog](prototype-sync-1080p.png)

## Horizontal overflow and zoom

Each viewport covered Workspace, Build, Project Configuration, Modules, synchronization to the project requirement and to the latest branch, for 42 checks. The measured document content fit the visible width in every case, including the layout space occupied by browser scrollbars.

| Viewport (CSS px) | Purpose | States with horizontal document scrolling |
| --- | --- | ---: |
| 1920×1080 | Wide screen at 100% | 0 / 6 |
| 1536×864, device pixel ratio 1.25 | Equivalent layout at 1920×1080 and 125% | 0 / 6 |
| 960×540, device pixel ratio 2 | Equivalent layout at 1920×1080 and 200% | 0 / 6 |
| 880×720 and 600×720 | Narrow editor and wrapping breakpoints | 0 / 12 |
| 390×844 and 320×640 | Small viewport and narrowest editor | 0 / 12 |

The two zoom simulations adjusted the browser viewport and device pixel ratio to model available CSS pixels. This covers layout wrapping. Font rasterization under native VS Code zoom needs observation in the host. No uncaught script exceptions occurred in the 42 transitions.

## Module row corrections

The actual row renderer supplied long module names, long subdirectories and an English status describing a temporary revision deviating from the project requirement. Fourteen more widths were checked. At a 421 px viewport, status and actions previously left the name only 33 px wide and the row grew to 1026 px high. At 320 px the status text exceeded its badge by 55 px. Both issues occurred even when overall document width looked correct.

At widths up to 600 px, the checkbox, name and action now occupy the first line. Status uses the remaining width below and can wrap at word boundaries. At 421 px the name area grew to 292 px and the example height dropped to 128 px. At 320 px both status and row content had zero horizontal overflow. The extension packages the [shared module row styles](../workbench.css).

## Host tool density correction and retest

In the initial test, each of five tools used four lines for its name, purpose, value and source. The heading for the following Build Process Environment section only appeared at y=1045. The revised layout combines the name, status, purpose, source and actions on one line, with the path or environment value below. At 1920×1080 the tool panel shrank from 673 px to 413 px. The next section moved up by 260 px to y=785. The first screen now shows names and values for ZEPHYR_BASE, ZEPHYR_TOOLCHAIN_VARIANT and ZEPHYR_SDK_INSTALL_DIR. All 42 page states across the equivalent zoom levels and narrow screens were retested with zero horizontal document overflow.

[简体中文](prototype-layout.md) | **English**
