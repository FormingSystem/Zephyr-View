# Source UML class diagram

[简体中文](source-class-diagram.md) | **English**

## Reading a project

Open Programming Studio, choose a C or C++ file in Project source and select **UML classes**. The diagram and source pane share the current editor buffer. Use it to find a declaration, see which objects a type stores by value, and follow members that refer to other types.

| Source evidence | Diagram notation | Source location |
| --- | --- | --- |
| Named struct, union, enum or class definition | Type box with declaration kind and members | Definition or member line |
| Member stored by value with a known type in this file | Filled diamond at the containing type | Member declaration |
| Pointer or C++ reference to a resolved type | Navigable association | Pointer or reference declaration |
| Explicit resolved base in a C++ declaration | Open triangle pointing to the base | Base declaration clause |

## Interfaces and design choices

The host builds nodes and edges from the current file's preprocessed tokens. Each edge carries its endpoints, kind, label, conditional state and supporting source line. The view and exporter consume the same model. Resolution stays in the current file. Types declared elsewhere remain readable as member text. Conditional state comes from the existing scanner. While an edit leaves a delimiter open, the last valid graph stays visible. Navigation and export resume when the new revision parses successfully.

The built-in view supports offline browsing, keyboard selection and source navigation. For interchange, the user can save a `.puml` file. When the PlantUML extension is installed, users can explicitly invoke its preview using its own rendering settings. [UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/About-UML) · [PlantUML class diagrams](https://plantuml.com/class-diagram) · [PlantUML for VS Code](https://marketplace.visualstudio.com/items?itemName=jebbs.plantuml)

## Acceptance

Check value members, pointers and explicit inheritance against their source lines. Cover duplicate names, conditional branches, callbacks, incomplete buffers and empty diagrams. Exercise both themes, narrow layouts, keyboard operation, save cancellation and edits during export. Finally, use an actual Zephyr source file in a 1920×1080 separate studio window and follow at least one relationship to its declaration.

### Observed results

At Zephyr commit `25c8f4a23988`, the scan covered 2,255 headers under `include/zephyr`. File and syntax checks succeeded for 2,245. Of those, 1,000 produced type diagrams. Seven exceeded the existing 256 KiB limit and three reported incomplete syntax. All emitted edges had endpoints. Semantic spot checks used the SD card and kernel thread headers.

In a separate VS Code window, selecting `sdio_func.card` located line 50 of `sd.h`. Selecting `sd_card.func0` in the opposite direction located line 82. Both themes were checked at 1920×1080. The renderer shipped with version 2.18.1 of the PlantUML extension rendered the exported model as SVG locally. Its preview also opened in an isolated VS Code profile. [SD card source](https://github.com/zephyrproject-rtos/zephyr/blob/25c8f4a23988dd3b2cfb463613622738298c2d6c/include/zephyr/sd/sd.h) · [Studio screenshot](../../extension/guides/media/uml-class-diagram.png)

[简体中文](source-class-diagram.md) | **English**
