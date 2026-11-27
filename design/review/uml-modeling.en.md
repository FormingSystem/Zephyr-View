# UML modeling design review

[简体中文](uml-modeling.md) | **English**

## Reading code and designing a system

When reading existing C/C++ code, open **UML Class Diagram** in Program Studio and select a member or type to visit its declaration. To discuss a design before implementing it, use **UML Modeling** to choose a diagram and create an editable PlantUML sketch. For example, a sequence diagram can show a sampling thread putting a message into a queue, a worker receiving it, and the timeout path. To discuss a deadline, choose a timing diagram and label the time unit. [Source class diagrams and navigation](source-class-diagram.en.md)

The design artifact is a plain `.puml` file. Its author can edit elements and links, save a copy, reopen it, or commit it alongside the application. The author supplies messages and times. Source analysis currently derives type relationships backed by declarations. The fourteen starters provide graphical notation. XMI interchange, UML metamodel validation and C generation from a sketch would each require a separate implementation. [OMG UML 2.5.1 specification and interchange models](https://www.omg.org/spec/UML/2.5.1) · [PlantUML on diagram consistency](https://plantuml.com/faq)

## Tool selection

| Tool | What the author edits | Role in the extension |
| --- | --- | --- |
| PlantUML (`jebbs.plantuml`) | Elements, relationships and labels in a `.puml` file. The extension previews or exports the diagram at the cursor. | Preferred. Zephyr View owns the catalog and starters and delegates rendering to an optional extension. Editing and saving work before installing it. [Extension manifest](https://github.com/qjebbs/vscode-plantuml/blob/master/package.json) · [PlantUML diagram types](https://plantuml.com/) |
| Mermaid | A `mermaid` fence in Markdown can describe flowcharts, classes, states or sequences. VS Code has included Mermaid rendering in Markdown preview since 1.121. | Suits diagrams published in a README or tutorial. It uses its own syntax and Markdown preview. [VS Code 1.121 release notes](https://code.visualstudio.com/updates/v1_121/#_mermaid-diagrams-in-markdown-preview-and-notebooks) · [Mermaid syntax](https://mermaid.js.org/intro/syntax-reference.html) |
| UMLet (`TheUMLetTeam.umlet`) | Place elements on a `.uxf` canvas, drag connector endpoints and edit element properties. Activity and sequence elements have dedicated text syntax. | Optional free-layout canvas. Create or open a separate UXF file to preserve its editable layout in the project. [UMLet for VS Code](https://marketplace.visualstudio.com/items?itemName=TheUMLetTeam.umlet) · [Editing in UMLet](https://www.umlet.com/faq.htm) |

## Free-layout canvas

In **UML modeling → Free-layout canvas (UMLet)**, choose whether to create or open a canvas. To start, choose an unused `.uxf` filename in the save dialog. Double-click an element in the right-hand palette to add it to the canvas. Rename it or enter members in Properties, drag it into position, then use the system save shortcut to write the layout. Choose **Open canvas** to resume an existing diagram. When UMLet is missing, the prompt offers its extension details.

The adapter calls `vscode.openWith` with the registered view type `uxfCustoms.umletEditor`. UMLet also provides `umlet.createNewDiagram`. Zephyr View uses a save dialog so the author can choose both the name and the location. UXF stores elements, properties and coordinates. PlantUML sketches use separate `.puml` files, and each format opens in its corresponding editor. [Editor registration and commands](https://github.com/umlet/umlet/blob/master/umlet-vscode/package.json) · [Empty files and palette controls](https://github.com/umlet/umlet/blob/master/umlet-vscode/README.md)

## Choosing among fourteen diagram types

Choose a diagram by the engineering question it answers. The last four entries use limited notation. The picker should make that scope visible. The other ten use documented PlantUML elements, including `package` for package boundaries and dependencies. [PlantUML diagram index](https://plantuml.com/) · [Classes and packages](https://plantuml.com/class-diagram) · [Activities and branches](https://plantuml.com/activity-diagram-beta)

| Diagram | Question in a Zephyr project | What to read |
| --- | --- | --- |
| Class | Which type owns a sample? | Types, members, association or composition |
| Object | Which queue belongs to each sensor instance? | Instances, attribute values and links |
| Package | Which interface packages does the driver layer depend on? | Package boundaries and dependency direction |
| Component | Who consumes the sampling interface? | Components, interfaces and dependencies |
| Deployment | Which processor runs each firmware image? | Execution nodes and deployed artifacts |
| Use case | Which goals can the operator accomplish? | Actors, system boundary and goals |
| Activity | Should a failed sample trigger a retry or stop collection? | Actions, conditions and control flow |
| State machine | Which event wakes a sleeping device? | States, events and transitions |
| Sequence | Which thread sends the message, and which receives it next? | Participants and ordered messages |
| Timing | How much time passes between interrupt and wakeup? | Time scale and state changes |
| Composite structure (limited) | How do the parts inside a sampling subsystem connect? | Nested elements and links depict parts and connectors |
| Profile (limited) | Which domain terms should identify threads or devices? | Stereotype and metaclass labels convey the extension. The author checks applicability constraints |
| Communication (limited) | Which object links carry the messages? | Numbered, directed messages on links. The author maintains their order |
| Interaction overview (limited) | How do initialization, sampling and recovery interactions fit together? | Activity control flow refers to named interactions. The author maintains the references |

## Preview, offline operation and licensing

1. **Create and edit.** Search the picker by diagram type or purpose, choose the save location and use an unused filename to create the model. To resume work, open an existing `.puml` or `.plantuml` from the same picker. Canceling the save dialog returns to the editor. Plain-text editing and saving require only the editor.
2. **Optional preview.** When the user requests a preview in a trusted workspace, first activate the target diagram’s editor. The provider manifest registers the language ID `plantuml`, the `.puml` extension and the `plantuml.preview` command. Its own `plantuml.exportCurrent` command exports the current diagram. Keep the editable text available if the provider is missing. [Command and language registrations](https://github.com/qjebbs/vscode-plantuml/blob/master/package.json)
3. **Offline setup.** Select `plantuml.render = Local` in the PlantUML extension and have Java and a local JAR available. Layout for diagrams such as classes uses Graphviz’s `dot`. A sequence diagram can verify the Java path first. Windows distributions may include the JAR and Graphviz. Test the desired diagram before installing an additional dependency. Starters use packaged text with no network resources. [Local renderer setup](https://github.com/qjebbs/vscode-plantuml#requirements-for-local-render) · [Graphviz requirements and checks](https://plantuml.com/graphviz-dot)
4. **Server rendering.** `PlantUMLServer` sends diagram content to the service configured in `plantuml.server`. The payload can include expanded includes. The receiving service can recover the source even when it arrives compressed in an encoded URL. Invoke the provider on an explicit preview request using the user’s settings. When server rendering is selected, confirm the transfer before rendering. For unpublished interfaces or chip names, use a local renderer or a server approved by the team. [Server rendering](https://github.com/qjebbs/vscode-plantuml#about-render) · [Text encoding](https://plantuml.com/text-encoding)
5. **Distribution.** Zephyr View maintains its templates and connects through public extension commands. The provider’s source has an MIT license. The PlantUML engine comes in several licensed distributions. Bundling a JAR, Graphviz or third-party source in a future VSIX would require checking the license and notices for each selected artifact. [Provider license](https://github.com/qjebbs/vscode-plantuml/blob/master/LICENSE.txt) · [Engine distributions and licenses](https://plantuml.com/download)

## Acceptance checks

- **Create and save.** With the provider absent, create each of the fourteen sketches. Edit an element or message, save as `.puml`, reopen and verify the change. Check the filesystem after canceling a save and inspect the first draft after creating a second one.
- **Notation.** Render all fourteen starters offline and inspect their labels and direction. Check the numbering in communication, nesting in composite structure, stereotypes in profile, and branching in interaction overview. A generated image verifies syntax. The review must also check the intended meaning.
- **Provider.** Open two different diagrams. Request a preview from one and verify that its contents appear. Check editing and recovery with the provider absent, with a missing renderer dependency, and with a working preview.
- **Studio.** Inspect diagram names and limited-notation hints in a detached window and a narrow editor group. Complete selection using the keyboard. Verify that source class navigation and export remain independently accessible.

### Verified drag and save

Installed UMLet 15.1.0 from the Microsoft Marketplace in an isolated VS Code profile and opened a UXF containing a `Sampler` class. The tab reported `uxfCustoms.umletEditor`. After a pointer drag 130 units right and 80 units down, the saved XML read back from disk showed coordinates changing from `(140,160)` to `(270,240)`. The element retained its `140 × 80` size and `read()` member. This check covered the local Windows desktop editor.

[简体中文](uml-modeling.md) | **English**
