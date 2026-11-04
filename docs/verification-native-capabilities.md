# Native capability verification — 2026-11-04

## Implemented and checked

| IDs     | Evidence                                                                                                                                                                                                                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N01     | Group/ungroup transaction tests; stable native IDs/UIDs; exact rotated-group flattening; shear rejection; failed batches leave the slide unchanged. Native PowerPoint accepted the group and preserved both endpoint bindings when the group moved.                                                                                      |
| N02     | Native straight/elbow bindings; node move geometry assertion; delete-detach and delete-reject rollback; persisted routing metadata; native custom-path site count and attachment accepted by PowerPoint.                                                                                                                                 |
| N03     | Letter/4:3 native dimensions round-trip; invalid dimensions do not modify XML; CLI Letter creation; normalized canvas size/aspect ratio in state.                                                                                                                                                                                        |
| N04     | Embedded XLSX/cache consistency for bar, column, line, pie and line-first combo input. Actual PowerPoint **Edit Data in Excel** opened the embedded Data sheet, with Category/Volume/Rate and Q1–Q3 values. Editing the first value to 15 and a category to Q1 edited refreshed the native chart. UI edits were discarded.               |
| N05     | Structured source/dependent-cell preflight; independent-formula analysis tests; unknown/dynamic dependencies rejected; formula refusal rolls back an earlier shape creation in the same batch. Existing chart/workbook isolation tests pass.                                                                                             |
| N06/N07 | Native custom geometry/gradient XML, public-schema validation and rollback; PowerPoint reports an editable freeform and native gradient; custom connection site remains attached; visible wave/gradient inspected in PowerPoint.                                                                                                         |
| N08     | Physical row heights 25.2/32.4/57.6 pt read back from PowerPoint; merged header width 288 pt versus ordinary cell width 144 pt; rich-content append/unmerge tests; commit validation rejects incomplete low-level merges and accepts complete atomic batches.                                                                            |
| R01/R02 | Original 0.6.0 trimmed engine emitted empty number-format metadata and color objects. Fixed 0.6.1 trimmed binary passes ten browser cases covering formats, explicit/theme colors, duplicate names, bar/line/combo, unsupported-format diagnostics, and initialization/CDN failures. Deckuse single/batch rendering propagates failures. |

## Automated checks

- Deckuse: 56 test files, 385 tests passed in the final full run; typecheck and lint pass.
- New source updates after that run were limited to read-only table row-height inspection and were checked with the native capability and table-property regression suites.
- PPTX/DOCX integration-write smoke: 2/2 documents pass.
- Agent package check: resources, local skill links, command discovery, atomic blank recipe, PPTX export, DOCX write/export pass.
- deck2html targeted format/color/legend/community regression: 78 tests pass, including six new trim-safe serialization tests.
- Broader deck2html selection: 310 pass / 17 fail. Three stale expectation failures were reproduced against unmodified HEAD (bar category-gap expectation, line smooth/dash expectation, legend-entry representation); the other failing tests require unavailable real-document samples. This broader historical corpus is not reported as fully passing.
- One early full Deckuse run hit 5-second limits in multi-process CLI workflows on the loaded host. Those two integration cases now have explicit 30-second budgets; assertions remain unchanged and the complete rerun passes.

## Packed installation and release boundary

Both Deckuse and the macOS arm64 deck2html 0.6.1 companion were packed and installed into an isolated temporary project. Local package overrides selected the prepared companion tarballs. The installed native engine reports 0.6.1. The packed install passed the ten-case browser matrix and Deckuse single/batch/failure propagation using the default installed converter, without a binary override.

No npm packages have been published. The repository's normal dependency lock still resolves published deck2html 0.6.0; publish the prepared companion patch for all supported RIDs, then refresh the Deckuse dependency/lock and repeat release checks. Until then, the explicit native-binary selector or local packed-package overrides are required to exercise the preview fixes. This distribution step is separate from the verified local implementation.

## Reproduce

See [native-capabilities.md](native-capabilities.md) for exact commands, supported subsets, migration notes and release order. `scripts/create-native-capability-fixture.mjs` produces a synthetic editable PPTX and a companion acceptance checklist. `scripts/check-native-preview.mjs` pins ECharts locally and can validate either the checkout or an isolated package install. `scripts/check-native-office.mjs` checks only the synthetic presentation and never closes unrelated windows.

User reference documents and raw evidence logs remain outside the npm package. The original user edit in `src/version.ts` is preserved.
