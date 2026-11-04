> Historical validation record. LibreOffice render references below describe a removed implementation, not current instructions or evidence for the HTML pipeline. Current rendering uses deck2html/Playwright only; see agent-reliability.md.

# v1.6 safety improvement verification

Verified on 2026-11-02 (UTC), macOS 26.6.2 arm64, PowerPoint/Word 16.78. Specimens are synthetic, not the external reviewer's private documents. Committed native input files, PDF output, page PNGs and SHA-256 inventory are under `test/fixtures/visual/native/`.

## Implemented and exercised

- Word replacement: immutable original matches, conservative mixed-format policy, common-prefix/suffix preservation, cross-document field/comment protection, inline barriers, Unicode-safe bounds, dry-run run/format evidence, direct-run guards and failed-batch preservation.
- Charts: fixed-size constant A1 numeric/text writes, shared strings, quoted sheet names, all affected caches, conflicting-write refusal, concrete-shape/chart/workbook isolation, same-batch repeated writes, duplicate-slide editing, dry-run, rollback, undo, reopen and strict delivery.
- Delivery validates the actual output snapshot; known drift or unverifiable data cannot replace an existing destination. Ordinary structure mode still supports inspecting and repairing documents with pre-existing data issues.
- Visual diagnostics distinguish factual bounds/missing references from heuristic text/overlap concerns. Image review objects include page, target and media evidence. Inherited/grouped geometry and font substitution remain unverified.
- Monitor browser test exercised ready → pending → stale conversion failure with no JavaScript errors. Reconnecting clients receive the prior rendered revision plus the current failure, not a false success.
- Seven scenario references share one common agent workflow; schemas and CLI help include new options, and the npm package includes these skill files.

## Native Office evidence

PowerPoint opened and exported all eight controlled chart cases to PDF. Every page was rendered and inspected. The first inspection found invisible line strokes and unwanted category-based color variation; the writer was fixed and the native baseline regenerated. The final baseline includes visible line/combination strokes, matching series legends/colors, readable primary/secondary axes, labels, a wrapped long title and Chinese labels. Existing HTML fidelity warnings remain because native success does not certify deck2html.

The embedded-workbook specimen duplicates a chart page, updates copied values/name, verifies the original workbook bytes unchanged, and exports with delivery validation. PowerPoint opened it, exported it to PDF and saved a fresh PPTX. Reinspection of that native-saved package found both original and copied chart/cache sources consistent. The native-saved package is retained as a parser/verification regression specimen.

Word opened the synthetic two-page DOCX and exported PDF without changing source bytes. Both native PDF pages were inspected: Chinese heading, body, table and second-page content were visible.

## LibreOffice and font environment

The system `soffice` is a broken launcher pointing at a missing `/Applications/LibreOffice.app`; Codex's bundled LibreOfficeDev and Poppler were used instead. The renderer produced both pages, reported version/count/hash, and rejected page 3 while preserving an existing output.

The bundled renderer's default Fontconfig setup omitted Chinese glyphs even though conversion succeeded. Re-running with a temporary Fontconfig file listing `/System/Library/Fonts` and `/System/Library/Fonts/Supplemental` restored the Chinese heading/body/table and second-page characters. No system settings or font binaries were changed or bundled. Both the failed-default and corrected images are retained. Layout differs from Word, as expected; generic font substitution detection and native-equivalence certification remain unknown.

## Explicit limits

The external reviewer's original PPTX/DOCX corpus was not supplied, so those exact files could not be rerun. Office “Edit Data” was not clicked interactively; data consistency was established from cell/cache contents and checked again after native save. This is recorded separately from opening/rendering/visual inspection. No universal promise is made for formulas, pivots, linked workbooks, advanced charts, unsupported extensions, fonts or aesthetic quality; unsupported writes fail explicitly.

## Checks

Final automated run: **35 test files, 253 tests passed**. Build/typecheck, community boundary check, dual-format integration smoke (2/2 files), monitor browser QA, npm skill/reference inclusion and diff whitespace checks passed.

Run `pnpm build`, `pnpm test`, `pnpm test:integration-writes:smoke`, and `pnpm check:no-commercial-leak`. Use the reproduction scripts in the migration guide for optional native and browser checks.

The repository has existing lint failures: a clean HEAD snapshot produced 172 ESLint errors; the current implementation produced 170 with zero new `(file, rule, message)` diagnostics in the comparison. New backend/data/audit modules are lint-clean. This is not reported as a passing full-repository lint check.
