# @deckflow/deckuse

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
