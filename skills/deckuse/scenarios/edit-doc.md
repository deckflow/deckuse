# Edit DOCX

Required modules: [CLI context](../modules/cli-context.md), [Preservation](../modules/preservation.md), [Verification/recovery](../modules/verification-recovery.md).

Preserve the original and a no-edit export baseline. Inventory paragraphs, styles, tables and bookmarks; resolve the exact text/structure to change. Use Word targets from the current inventory rather than constructing slide addresses.

Prefer safe `replaceText` for literal replacements; the installed contract must support the desired formatting policy. Mixed-run ambiguity, tracked revisions, fields, hyperlinks, comments and protected content can refuse edits. Narrow the change rather than forcing `firstRun` or rewriting protected XML. `firstRun` accepts a specific formatting inheritance change; it is not permission to bypass protection.

Batch authorized writes, inspect current revision and apply a guard for optimistic concurrency. Reconcile partial/unreadable responses before retrying. Template field mapping can use bookmarks or verified literal tokens; use separate workspaces per output.

Compare edited package content and relationship semantics against the no-edit baseline. Preserve text whitespace, XML order, surrounding formats and unrelated runs. Validate and export to a new DOCX path. Use available Word review for pagination, table splits and fonts; disclose which checks were actually performed. Do not apply PPTX geometry to DOCX. In 1.8.0 [DOCX HTML preview](preview-doc.md) is available for approximate page review.
