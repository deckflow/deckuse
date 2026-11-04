# Populate a presentation template

Input: brand/template PPTX plus content/data records. Use edit-deck for a local text change instead. Output: one independent presentation per record, preserving template design and unmodified objects.

1. Read verification-recovery. Hash/copy template; init a workspace, list slides/layouts/shapes and export a no-edit baseline. Map content keys to actual target IDs/placeholders and repeated structures. Record required/optional keys, types, units, missing values and overflow policy; resolve ambiguous mapping before writes.
2. Validate all records before mutation. Use a new workspace initialized from the original for each output; never let one customer's content leak into the next. Assign distinct output paths and preserve the template.
3. Query targeted schema for setText, duplicate, image/table/chart operations as needed. Build one coherent apply batch per output, using current IDs and explicit values; duplicate repeated structures only when authorized. Dry-run before apply. Read operations for chart/table details, including embedded workbook restrictions.
4. Re-inventory, compare against the baseline and allowed key/structure changes. Verify every required key was populated, no unintended sample text remains and shared assets/layouts were preserved. Validate delivery data, render all populated pages and inspect long text, missing glyphs and repeated rows.

Recovery: reject incomplete records with their keys before writing; do not guess recipients or data. On response loss reconcile history and targets before retrying. Rebuild a failed record in an independent absent workspace when rollback cannot be proven. Deliver outputs with record-to-file mapping and per-output verification, including unverified native review.
