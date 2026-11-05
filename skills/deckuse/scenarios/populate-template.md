# Populate a template

Use for mapping supplied content/data into named fields or repeated layouts, including multiple independent outputs. For a few ordinary edits use [Edit](edit.md); for a new visual design use [Create](create.md).

Required modules: [CLI context](../modules/cli-context.md), [Preservation](../modules/preservation.md), [Verification/recovery](../modules/verification-recovery.md). Load [Typography/layout](../modules/typography-layout.md) for overflow or multilingual fields, [Charts/tables](../modules/charts-tables.md) for structured data.

1. Inventory the actual template. Map each data field to a real target or a unique literal token; record expected cardinality, required/optional fields, formatting, source and output name. Preserve brand layouts and existing object semantics.
2. Validate records before mutation: missing keys, duplicate output names, numeric units, category counts, empty values and filename/path collisions. Treat content as literal data, never shell commands. Do not infer facts or customer values that were not supplied.
3. For each output initialize a separate workspace from the original template. Reusing a previously populated customer deck risks data leakage. Keep the original and a no-edit baseline.
4. Use native target writes where possible. For unique text tokens, adapt [populate-pptx.json](../examples/populate-pptx.json), which uses literal `replaceText` and `regex: false`. It is valid for a template containing `{{customer}}`; check matches before and after. Replacements are not a general template expression engine. Scope intentionally repeated tokens and consider replacement-order collisions.
5. Batch each output's fields into one apply operation. Retain per-record success/failure results; never call a partly completed batch “all outputs generated.” Avoid overwriting existing output names without task authorization. On resume, verify completed output IDs/hashes and restart only incomplete records; do not populate again from an already filled customer's deck.
6. Check exact expected content, unresolved tokens, native data objects and unchanged template parts. Check each output for values belonging to a different record and confirm the original template hash is unchanged. Render long labels, the maximum-content record and each delivered page; representative review alone must not be described as all-pages visual approval.
7. Export independent PPTX files and a concise completion manifest: record/output ID, validation status, preview/visual/native states and unresolved fields. Keep customer contents out of public diagnostic bundles unless explicitly authorized.

For DOCX template mapping, use Word inventory/bookmarks and [Edit DOCX](edit-doc.md); do not apply slide geometry to Word. The primary route is edit-doc with template mapping as an additional task module.
