# Audit DOCX

Required modules: [CLI context](../modules/cli-context.md), [Preservation](../modules/preservation.md), [Verification/recovery](../modules/verification-recovery.md).

Create isolated inspection artifacts, preserve the original and default to no content mutation. Inventory paragraphs/styles/tables/bookmarks, package relationships and protected structures. Compare to a no-edit baseline when assessing preservation; ZIP bytes alone are insufficient.

Check heading order, expected text, table content and available relationship validation. Inspect field/comment/revision/hyperlink boundaries without removing protection to make the audit pass. A read refusal is an explicit coverage limit.

Native pagination requires an available Word environment. In 1.8.0 [DOCX HTML preview](preview-doc.md) provides approximate page review; record it separately. Use consistent fonts/backend for comparisons; native page count and visual review are distinct from structural validity. Report definite errors, formatting risks, unreviewed pages and unsupported checks separately. If repair is requested, transfer only the authorized scope to [Edit DOCX](edit-doc.md), retaining evidence and inventory.
