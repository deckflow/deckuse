# Audit a presentation

Use for diagnosis, compliance/content checks or quality review of an existing PPTX. Default to reporting; execute repairs only when the user's request includes them. If the task also asks for changes, audit first and hand the authorized scope to [Edit](edit.md).

Required modules: [CLI context](../modules/cli-context.md), [Preservation](../modules/preservation.md), [Verification/recovery](../modules/verification-recovery.md). Load data/layout modules only as needed.

1. Work from a preserved original in an isolated task workspace. Record requested checks and the baseline; creation of audit artifacts is separate from editing source content.
2. Read status, slides, affected shapes and structural diagnostics. Check relationships, expected content, page counts, external/media dependencies and available chart data. Review images as images: an image containing a chart is not automatically a verified native statistical chart.

```bash
deckuse status --workspace ./ws --json
deckuse inspect --workspace ./ws --json
deckuse validate --workspace ./ws --json
deckuse list slides --workspace ./ws --json
```

3. Render/review the requested pages; disclose coverage. Classify definite structural failures, heuristic geometry/text risks, visual observations and content/source uncertainty separately. Unsupported workbook verification is unverified, not confirmed data corruption.
4. For each finding provide page/object, observed issue, evidence, severity, proposed remedy and verification limit. Quote document content only as needed. Distinguish existing behavior/capability boundaries from regressions and user-input errors.
5. Confirm no repair/apply/undo or original-file writes occurred during a report-only audit. List repair candidates without executing them. If source recovery is needed, preserve transaction evidence and explain the blocked check.
6. Deliver the report and actual review states. A valid ZIP/XML package does not certify the design, fonts, accessibility, or native PowerPoint opening.
