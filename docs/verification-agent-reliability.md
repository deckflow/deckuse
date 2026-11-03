# Agent reliability verification

## Implementation coverage

- CLI input errors use stdout JSON envelopes; schema command listing and reachable-definition slicing are tested.
- PPTX/DOCX persist failures restore dirty source, package, metadata, operation log, Git index and refs. Tests inject source/package/metadata/log failures and Git index errors.
- Process interruption before and after commit is tested in child processes holding the write lock. Invalid recovery evidence returns RECOVERY_REQUIRED and is preserved.
- Initialization stages private content, reserves the destination, refuses nonempty directories, permits one concurrent initializer, and preserves unrelated files on failure.
- Slide names survive export/reimport. Result identities match inventory and final indexes after insertions.
- HTML batch tests retain successes around a failed page and reject mixed snapshots. LibreOffice batch tests verify one conversion and per-page failure retention with a mocked backend.
- Packaged resources, skill links, Blank recipe, CLI help template, PPTX export and DOCX writes/export execute from an npm tarball, using the checkout's dependency installation.

## Checks performed

- Build and TypeScript checks passed.
- Full suite: 43 files, 280 tests passed; focused workspace/render tests also passed after the final ignore-file preservation change.
- Integration write smoke: PPTX and DOCX both passed (57 checks passed, six expected skips, zero failures).
- Community boundary check passed.
- Changed files passed formatting checks and git diff --check.
- ESLint was compared to an isolated archive of the original HEAD: both have 170 existing errors. No additional lint errors remain. This does not mean the repository is lint-clean.
- No registry publication or Git commit was performed.

## Development performance matrix

Environment: Apple M1 Pro, macOS arm64, Node v24.14.1. Five process-cold and five
preloaded cases were run, each comparing 142 separate write processes with one
142-operation batch (seven added pages and 135 content operations). Three cases
ran concurrently. The OS filesystem cache was not evicted.

| Median seconds                | Process-cold | Preloaded |
| ----------------------------- | -----------: | --------: |
| Individual writes             |        89.87 |     87.81 |
| Single batch                  |         4.01 |      4.21 |
| Eight individual HTML renders |        53.40 |     64.55 |
| One eight-page HTML batch     |        46.50 |     52.98 |

All twenty rendering comparisons completed without errors. Across ten cases,
all eighty single/batch HTML PNG pairs had identical SHA-256 hashes. This verifies
preview consistency, not PowerPoint layout fidelity or font/native review.

The matrix ran during development, with builds occurring between samples; no
immutable per-sample binary fingerprint was captured for this run. These numbers
are exploratory measurements, not release-performance claims or guaranteed
completion times. Rerun the provided benchmark after freezing the build to make
release comparisons. Raw data, including phase spans and interval unions, was
saved locally as `__temps__/agent-reliability-benchmark.json` (not shipped in npm).
Index/mutation/pack/Git/conversion/screenshot spans are separate; nested spans
must not be added to wall time. Host scheduling and approval waits were not measured.

Actual LibreOffice batch rendering was not certified in this environment; the
optional path was tested with mocks and missing-backend failures. Native Office
visual review and font verification remain pending for user documents.
