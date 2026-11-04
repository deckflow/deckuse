# Native comments and Word review

Use this module when comments or native tracked changes are part of the user's
request. Keep ordinary direct editing as the default.

## Discover and inspect

Use `comments list` and `revisions list` with `--workspace` and `--json`. Refresh
native IDs after structural edits or an external Office save. Workspace revisions
are commit counters, distinct from native pending tracked changes.

Inspect the needed command contract with `schema --type TYPE --json`. Native
review writes require optimistic guards; direct CLI commands infer the current
revision unless `--expect-revision` pins it. Use `apply --input` for atomic batches.
A single proposeChanges command contains its own operations array.

## Comments

`comments add` takes `--author` and `--anchor` JSON plus `--text`. Word anchors use
body paragraph endpoints and UTF-16 offsets; PowerPoint supports slide positions,
shape anchors, and shape text ranges. Do not split surrogate pairs or cross Word
cell/story boundaries. Read unresolved anchors without guessing a replacement.

Use `reply`, `resolve`, `reopen`, and `delete`. Root deletion needs `--thread`.
Resolved or unknown-state threads need reopening before replies. Legacy PPTX
threading and older Word compatibility modes need explicit `comments upgrade`;
Word compatibility changes can affect layout. Preserve the user's choice about
upgrading rather than converting a document silently.

Deleting commented PowerPoint objects/slides is protected. Explicit
`commentsPolicy: "delete"` removes attached threads. Slide copying creates
independent comments; use `commentsPolicy: "omit"` when comments should not copy.
Do not bypass unknown-anchor errors with direct XML edits.

## Word revisions

Use `revisions view --view original|final|markup` for projections, checking
`complete` and opaque structures. Inventory includes old/new property XML and
locations; recognition of a type does not imply every decision is supported.

Use `revisions propose --input proposal.json` for native proposals, with explicit
author and operations. Operations cover text/formatting, paragraph changes, paired
body moves, regular rows/columns, and reversible vertical cell merge/split. Obtain
exact fields from `schema --type proposeChanges --json`. Horizontal/rectangular
merges, irregular/nested tables, cross-section moves, and auxiliary-story writes
are refused. Settle existing revisions before reconstructing their paragraph.

Before `accept` or `reject`, run `preview --decision accept|reject` with the same
`--ids` JSON array or `--all`. Honor blocked reasons and requiredIds; do not drop
unsupported members to make a partial transaction succeed. Externally changed
operation-group metadata blocks uncertain partial decisions. Header/footer,
footnote/endnote, comment, and text-box revisions remain read/projection-only.

After editing, validate and export. Native Office save/re-read verification is
needed when Office interoperability matters; an openable ZIP or a successful PDF
conversion alone does not establish correct review semantics.
