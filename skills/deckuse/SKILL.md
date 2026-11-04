---
name: deckuse
description: Create, replicate, edit, populate, audit, preview or export PPTX and DOCX with the Deckuse CLI. Route by format, inputs and preservation goals; PDF and images are reference inputs, not native editable workspaces.
---

# Deckuse task router

## Version handshake and resource loading

Use this installed skill directory, including [manifest.json](manifest.json), rather than online main documentation. Check `deckuse --version` once per installed binary/session. These workflows target CLI >= 1.7.0 (community). Older installations must upgrade or inspect targeted schema/help before using a step; never silently omit a preservation or verification gate.

Cache discovered contracts keyed by actual binary path and version. If a capability snapshot is available in that binary, use its documented interface; otherwise use `schema --list --json` and targeted `schema --type TYPE --json` only for commands needed now. Do not assume a future snapshot API exists. Invalidate on version/path changes; query unknown fields before writing. Read only the selected scenario and modules needed for its operations.

## Select format, then scenario

Infer from the actual input format and desired output. PPTX supports all six scenarios. DOCX supports create, edit, audit and preview/export; do not send slide geometry commands to Word. PDF/image extraction requires host tools and is not native Deckuse input. Ask only when missing information changes the result; reuse known goals and reasonable stated defaults.

| Goal and input                                                                      | Read next                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| New presentation from topic, outline, or source material; PDF used only for content | [create-deck](references/create-deck.md)             |
| Preserve appearance of PDF, image or screenshot in editable PPTX                    | [replicate](references/replicate.md)                 |
| Bounded changes to existing PPTX, including local text changes on a template        | [edit-deck](references/edit-deck.md)                 |
| Template plus structured content/data, repeated outputs or placeholder population   | [populate-template](references/populate-template.md) |
| Inspect existing PPTX without an authorized repair                                  | [audit-deck](references/audit-deck.md)               |
| Existing workspace/file needing only preview, export or render diagnosis            | [preview-export](references/preview-export.md)       |
| New Word document                                                                   | [create-doc](references/create-doc.md)               |
| Modify existing Word document                                                       | [edit-doc](references/edit-doc.md)                   |
| Inspect Word document                                                               | [audit-doc](references/audit-doc.md)                 |

When editable source and visual reference both exist, assess source preservation before rebuilding. A multi-stage task can audit then edit within the user's authorization; load the next scenario only when entering it. Audit alone does not authorize repairs.

## Shared invariants

- Preserve original files. Use `new` or `init` in an absent/empty workspace; never overwrite an input or delete an existing workspace to bypass a collision.
- For existing content, record original SHA-256, object inventory and a no-edit export baseline. Set allowed changes before writing; compare changed package parts against that baseline, preserving text whitespace, order and relationships.
- Locate targets from current inventory. Batch coherent mutations with `apply`; same-batch names can be forward references. Use explicit units (`px`, `pt`, `cm`, `in`, `%`); bare geometry numbers are EMU.
- Keep stdout JSON, stderr and exit status separate. Lost response/timeout is not proof of failure: reconcile `status`, `history` and inventory before retrying. Stop if the result is ambiguous; do not duplicate mutations.
- Community cannot write master/layout/theme part contents; slide layout rebinding is supported. Never bypass capability or protected-content refusals with XML edits.
- Validate after writes and render/inspect delivered pages when appearance matters. `ok: true` on export does not establish `data.valid`. Read diagnostics, including chart and table warnings.
- Report structure, external layout, native open, native visual review and editable object coverage separately. HTML/Chrome preview is approximate; unperformed checks remain unverified.

Carry between stages: scenario, format, input type, goal, preserved objects, allowed changes, output path, visual/editability target, selected modules, binary version and cached capabilities. Keep content plan, actual inventory and verification results distinct; reuse facts instead of asking again.

## Load modules only when needed

- [operations](references/operations.md): addressing, geometry, typography, tables, charts and Word mutation recipes.
- [verification-recovery](references/verification-recovery.md): preservation, delivery gates and failure recovery. Required before modifying existing files or delivering outputs.

## Install and evaluation

Install the CLI with `npm install -g @deckflow/deckuse`. Locate its package with `npm root -g`, then copy the entire `@deckflow/deckuse/skills/deckuse` directory into the host's skills directory (for Codex: `~/.codex/skills/deckuse`). Preserve references and manifest together; internal workflows need no separate installation. Keep CLI and skill from the same package version.

[Routing cases](routing-cases.json) are a bilingual behavioral evaluation corpus. Evaluate actual model choices separately from CLI/package tests; see [evaluation](references/evaluation.md).
