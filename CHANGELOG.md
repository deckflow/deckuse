# @deckflow/deckuse

## Unreleased

- Add native grouping/ungrouping, attached connector endpoints, custom path geometry, linear gradients, physical table row heights and region merge/unmerge commands.
- Add blank canvas dimensions, opt-in embedded chart workbooks, and read-only chart-data dependency preflight with safe independent-formula preservation.
- Detect chart initialization failures and number-format degradation during single/batch rendering. Companion deck2html fixes trimmed number-format/color serialization and renders limited bar/line combos in Community. Use `DECKUSE_DECK2HTML_BINARY` to test the companion build before its upstream release.

## 1.9.8

- Improve converter startup and report blocked preview as a structured handoff to the validated PPTX.

## 1.9.7

- Streamline agent verification and reproducible generation, and retire owned workspace cleanup artifacts by default.

## 1.9.6

- Add version-matched Skill discovery and prioritize browser-measured preview findings.

## 1.9.5

- Improve compact validation reports and make PPTX generation resumable.

## 1.9.4

- Expose compact first-draft discovery and preserve validated fallback snapshots.

## 1.9.3

- Harden managed PPTX writes and verify the generated package before handoff.

## 1.9.2

- Improve managed-agent authoring, review, recovery, and write replay.

## 1.9.1

- Improve native PPTX editing and chart data workflows.

## 1.9.0

- Add native grouping, connector and geometry operations, bounded workbook synchronization, and chart data preflight.

## 1.8.0

- Add native comments and tracked revision workflows for Office review.

## 1.7.0

- Add snapshot batch rendering, improve agent reliability, and update deck2html.

## 1.6.0

- Add safer Office data editing and visual verification workflows.

## 1.5.0

### Minor Changes

- 94e98bc: Add a read-only `find` command that ranks document elements from a natural-language query via TypeSafe.

## 1.4.3

### Patch Changes

- c445714: Add `deckuse repair` for unambiguous notesSlide back-pointers, surface `valid` on status/export, and emit per-page chart render plus table overlap candidates for agents.

## 1.4.0

### Minor Changes

- Harden PPTX/DOCX agent edit reliability: reclaim stale write locks, restore notes/undo/table fidelity, and fix query dedupe, cell style round-trips, and silent mismatches in query/cell reads/table height.

## 1.3.0

### Minor Changes

- 01cc29f: Add `deckuse new <workspace/>` to bootstrap a workspace from the bundled blank PPTX template (equivalent to `init` with `assets/default.pptx`).
- 1470c1f: Add a DOCX adapter with the same workspace loop as PPTX: paragraph addressing, cross-run text edits, and batch create commands.
- 8673e60: Add `setSlideLayout` to rebind slides by index or slide ref to a different layout.

### Patch Changes

- 8673e60: Fix image/video/audio media allocation when an older `@deckflow/deckuse` opc build lacks `archive.hasPartIgnoreCase`, and bump `@deckflow/office2html` to 0.3.5.

## 1.2.1

### Patch Changes

- Harden table layout and export, bump office2html, and sync npm README with agent skill install guidance.
- Updated dependencies
  - @deckflow/deckuse-core@1.2.1
  - @deckflow/deckuse-pptx@1.2.1
  - @deckflow/deckuse-docx@0.1.3
  - @deckflow/deckuse-key@0.1.3
  - @deckflow/deckuse-numbers@0.1.3
  - @deckflow/deckuse-workspace@1.1.2
  - @deckflow/deckuse-xlsx@0.1.3

## 1.2.0

### Minor Changes

- 6d11f42: Agent UX: length units (`px`/`pt`/`%`/…), rich text blocks, align/distribute, table auto/theme, chart labels/combo, monitor daemon
- 02f3051: Same-batch forward refs by shape name; inline `fill`/`stroke`/`blocks` on `addShape`; dotted `setProperties` keys
- Agent CLI: `deckuse schema`, clearer schema-validation errors, `deckuse measure`, intra-paragraph `runs`, text `wrap`/`anchor`/`cornerRadius`, arrow/elbow shapes, render fidelity warnings, monitor port conflict handling
- b085a32: Extract `@deckflow/deckuse-edition-config` so community and commercial builds share pptx/CLI source and only swap edition capability constants.

### Patch Changes

- Updated dependencies [6d11f42]
- Updated dependencies [b085a32]
  - @deckflow/deckuse-core@1.2.0
  - @deckflow/deckuse-pptx@1.2.0
  - @deckflow/deckuse-edition-config@1.2.0
  - @deckflow/deckuse-docx@0.1.2
  - @deckflow/deckuse-key@0.1.2
  - @deckflow/deckuse-numbers@0.1.2
  - @deckflow/deckuse-workspace@1.1.1
  - @deckflow/deckuse-xlsx@0.1.2

## 1.1.0

### Minor Changes

- add monitor feature

### Patch Changes

- Updated dependencies
  - @deckflow/deckuse-core@1.1.0
  - @deckflow/deckuse-pptx@1.1.0
  - @deckflow/deckuse-workspace@1.1.0
  - @deckflow/deckuse-docx@0.1.1
  - @deckflow/deckuse-key@0.1.1
  - @deckflow/deckuse-numbers@0.1.1
  - @deckflow/deckuse-xlsx@0.1.1

## 1.0.2

### Patch Changes

- 417cb9a: Fix global installation and report the package version from the CLI.

## 1.0.1

### Patch Changes

- Updated dependencies
  - @deckflow/deckuse-docx@0.1.0
  - @deckflow/deckuse-key@0.1.0
  - @deckflow/deckuse-numbers@0.1.0
  - @deckflow/deckuse-xlsx@0.1.0

## 1.0.0

### Major Changes

- readme update, node.js version update

### Patch Changes

- Updated dependencies
  - @deckflow/deckuse-core@1.0.0
  - @deckflow/deckuse-docx@1.0.0
  - @deckflow/deckuse-key@1.0.0
  - @deckflow/deckuse-numbers@1.0.0
  - @deckflow/deckuse-pptx@1.0.0
  - @deckflow/deckuse-xlsx@1.0.0

## 0.2.0

### Minor Changes

- publish

### Patch Changes

- Updated dependencies
  - @deckflow/deckuse-core@0.1.0
  - @deckflow/deckuse-pptx@0.1.0
  - @deckflow/deckuse-docx@0.0.1
  - @deckflow/deckuse-key@0.0.1
  - @deckflow/deckuse-numbers@0.0.1
  - @deckflow/deckuse-xlsx@0.0.1
