# Preview or export

Use when the user only needs screenshots, a packaged PPTX, or diagnosis of a preview failure. Reuse a suitable workspace; init a preserved original only when needed. Do not rebuild slide content for an export-only request.

Required modules: [CLI context](../modules/cli-context.md), [Verification/recovery](../modules/verification-recovery.md). For existing inputs use [Preservation](../modules/preservation.md).

1. Check workspace format, revision, structural state and whether source changes made the package snapshot stale. Export/rebuild source first when stale. A pure file copy needs no content reconstruction.
2. Use HTML/Chrome batch rendering for PPTX. Select all pages for delivery or the requested subset for an explicitly scoped review.

```bash
deckuse export ./output.pptx --workspace ./ws --json
deckuse render --workspace ./ws --all --output-dir ./review --json
deckuse render --workspace ./ws --pages 1,3-5 --output-dir ./review-subset --json
```

Use one batch selector with `--output-dir`; do not combine `--all/--pages` with single-page `--page/--output`. Single-page remains valid for a retry or requested one-page preview. Batch results are per-page: preserve successes and retry failed pages only.

3. Preserve stderr and structured failure details. Browser missing, browser launch failure, conversion failure and screenshot failure are different diagnoses. Use host-approved execution capabilities. Do not repeatedly launch a provider after the same unresolved failure, install dependencies silently or change rendering engines as a fallback.
4. Open the PNGs before claiming visual review. Keep input digest/revision, engine and font/native uncertainty. Export success still requires checking validation fields; `--from-package` copies the current snapshot rather than rebuilding manual source edits.
5. DOCX uses explicit `.docx` export; 1.8.0 also supports approximate HTML page previews via [DOCX preview/export](preview-doc.md). Native Word pagination remains a separate check. PDF output, if requested, requires an available and authorized external export path; do not imply `deckuse export output.pdf` supplies it.

Deliver actual output paths, selected pages, success/failure counts and completed review states. A screenshot alone is not final native Office fidelity approval.
