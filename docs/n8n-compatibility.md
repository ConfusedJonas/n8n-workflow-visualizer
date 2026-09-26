# n8n JSON compatibility notes

Research date: 2026-09-24. n8n source snapshot: [`099e8320285d686e0243f97da9b5b82b2052901c`](https://github.com/n8n-io/n8n/tree/099e8320285d686e0243f97da9b5b82b2052901c).

This project intentionally implements a permissive decoder for exported graph data. It is not a copy of n8n's frontend model and does not attempt to reproduce n8n execution semantics.

## Sources inspected

- n8n [`IWorkflowBase`, `INode`, `IConnections`, `IConnection`, and `NodeConnectionTypes`](https://github.com/n8n-io/n8n/blob/099e8320285d686e0243f97da9b5b82b2052901c/packages/workflow/src/interfaces.ts)
- Versioned [Execute Sub-workflow node](https://github.com/n8n-io/n8n/blob/099e8320285d686e0243f97da9b5b82b2052901c/packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.ts)
- Versioned [Execute Sub-workflow Trigger node](https://github.com/n8n-io/n8n/blob/099e8320285d686e0243f97da9b5b82b2052901c/packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflowTrigger/ExecuteWorkflowTrigger.node.ts)
- [Sticky Note node](https://github.com/n8n-io/n8n/blob/099e8320285d686e0243f97da9b5b82b2052901c/packages/nodes-base/nodes/StickyNote/StickyNote.node.ts)
- Official n8n documentation workflow [“Ask a human”](https://github.com/n8n-io/n8n-docs/blob/main/docs/_workflows/advanced-ai/examples/ask_a_human.json), used to verify AI connection serialization
- Two real exports supplied for local-only smoke testing. Their contents, names, IDs, and screenshots are not committed.

## Verified compatibility matrix

| Area | Representations observed | Decoder behavior |
| --- | --- | --- |
| Workflow identity | Exported `id` string; ID omitted | Export ID is canonical. ID-less workflows get a deterministic content-hash key and a warning; they are not candidates for database-ID resolution. |
| Document envelope | Workflow object, workflow array, `{data: workflow}`, `{data: workflow[]}` | Each candidate is parsed independently. Invalid peers do not discard valid candidates. |
| Nodes | `nodes[]` with name/type/id/position/parameters plus arbitrary fields | Only usable graph fields are normalized. Unknown types and fields are retained. Missing IDs/positions get stable local fallbacks and diagnostics. |
| Normal connections | `connections[sourceName][connectionType][outputIndex][]` | Every connection type and sparse output slot is preserved. Targets retain node name, target type, and input index. Missing source/target names become diagnosed dangling edges. |
| Multiple outputs/inputs | Separate output arrays, fan-out within a slot, target `index` greater than zero | Output and input indexes remain exact. No binary/main-only assumptions are made. |
| AI sockets | `ai_languageModel`, `ai_tool`, and `ai_memory` use the same outer structure as `main` | Known AI sockets receive distinct visuals. Any future or unknown connection type is preserved and rendered with a generic socket color. |
| Execute Sub-workflow versions | Versions 1, 1.1, 1.2, 1.3, and 1.4 are registered in current source | Parsing is based on tolerant parameter shapes rather than a closed version switch. |
| Database source | Legacy direct `workflowId` string; resource-locator object with `.value` and optional `cachedResultName`; omitted `source` defaults to database | Only static ID values resolve. A cached name is a display hint and is never used as identity. Expressions/interpolation/`undefined`/`null` are dynamic. |
| Parameter source | `source: "parameter"` and `workflowJson` as literal object or JSON string; expression strings | Literal workflows become caller-scoped embedded workflows. Expressions are dynamic. Malformed literal values are invalid. |
| Local file / URL | Deprecated `localFile` + `workflowPath`; deprecated `url` + `workflowUrl`; literal or expression value | Literals become non-expandable external placeholders. Expressions are dynamic. The browser never opens the path or fetches the URL. |
| Execute Workflow Trigger | Versions 1, 1.1, and 1.2; `inputSource` values `workflowInputs`, `jsonExample`, and `passthrough` | Trigger parameters are preserved. Expanded view hides exactly one valid enabled trigger and keeps all of its outgoing branches. Missing, disabled, or multiple triggers produce an explicit boundary warning. |
| Sticky notes | Position on node; `parameters.content`, `width`, `height`, numeric `color` | Notes are separated from executable nodes. Missing dimensions/color use stable visual defaults. Markdown is rendered without raw HTML or remote media. |
| Disabled nodes | `disabled: true`; field absent for enabled nodes | Disabled nodes remain visible. Disabled calls are inactive dependencies and are never expanded. |

The local smoke exports additionally verified a parent with 29 executable nodes and eight version 1.3 resource-locator calls, plus a child with 11 executable nodes and a version 1.2 passthrough trigger whose first main output fans out to two entry nodes. One child resolved when both files were imported; seven stayed explicitly missing. These counts are recorded without shipping the source exports.

## Expansion semantics

The visualizer resolves only static database IDs already imported into the browser and caller-scoped literal embedded workflows. It does not execute expressions, inspect credentials, contact an n8n instance, read local workflow paths, or fetch workflow URLs.

For a child with one enabled input trigger, the trigger is hidden and all of its branch targets are recorded as possible starts. They are highlighted only when the user enables Start nodes; main terminals use normal node styling. Outside edges terminate on the child boundary rather than crossing into internal nodes; invisible graph-only links retain traversal continuity for simulation without implying which runtime terminal n8n will return.

## Forward-compatibility policy

The parser accepts `unknown`, validates locally, retains raw workflow and node records, and emits structured diagnostics rather than rejecting an export because it contains an unfamiliar node or connection type. Parser normalization, workspace resolution, scene construction, and React rendering are separate modules. Stored raw objects are reparsed on restore, so a parser update can reinterpret previous imports without a data migration.
