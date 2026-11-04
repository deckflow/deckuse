# Audit a Word document

Inventory paragraphs, styles, tables, bookmarks, protected structures, and package relationships. Compare edits against a no-edit export baseline. Preserve character whitespace, XML order, and relationship semantics in comparisons. Check page count and selected pages with the same pagination backend and fonts. Report structural, external layout, and native visual verification independently.

### Native comments and tracked revisions

Use `deckuse comments list` and `deckuse revisions list` with `--workspace` and
`--json` before editing a reviewed document. Native revision IDs differ from
workspace commit revisions; refresh IDs after structural or external Office edits.
`revisions view --view original|final|markup` provides non-mutating projections;
check `complete` and opaque structures before interpreting the output.

Use `revisions propose --input proposal.json` to generate native revisions.
Before `revisions accept|reject`, use `revisions preview --decision accept|reject`
with the same `--all` or `--ids` selection. Do not ignore `blocked` or `requiredIds`.
Reply and resolve with `comments reply|resolve|reopen`; root deletion requires
`--thread`. Old compatibility modes need explicit `comments upgrade`. Preserve
unknown stories/anchors and do not work around protected-edit errors by flattening
XML. See [native review](review.md) for operation shapes and boundaries.
