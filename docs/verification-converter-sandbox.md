# Converter startup in restricted hosts

## Changes

Deckuse no longer injects a temporary `DOTNET_BUNDLE_EXTRACT_BASE_DIR`. Explicit settings are inherited unchanged; otherwise the runtime chooses its default. `extractionBase: null` with `extractionSource: runtime-default` means the actual runtime path was not observed. Render and monitor share binary selection, arguments, bounded execution and native error classification. Errors preserve exit code/signal and identify directory, write or commit extraction failures when the runtime message permits it. `retryable: false` disallows unchanged automatic retries, not recovery after a host configuration change.

Browser preflight reports cleanup failures in `cleanupWarnings`, with the retained probe path. A failed write remains the primary failure even when cleanup also fails. A successful write plus failed cleanup does not establish that launching a browser is impossible. Actual launch remains separately tested, and launch failure caching excludes varying cleanup paths.

The companion deck2html change ships complete self-contained multi-file runtimes. All platform wrappers, packaging whitelists, postinstall, local installation, build and edition-scan scripts use that layout. No installation hook runs the converter or warms caches. CLI and API signatures remain unchanged; consumers should obtain the executable through `getBinaryPath()`.

## Verification performed

- Deckuse build, TypeScript no-emit check, changed-source ESLint and diff whitespace checks passed.
- Six targeted test files passed (45 tests), then the added real-process monitor environment regression passed with its suite (17 tests; 46 distinct targeted cases overall).
- Built the macOS arm64 multi-file runtime and passed the edition scan.
- Packed the actual platform and main npm packages, installed the tarballs into an isolated job, and tested help/version plus PPTX and DOCX conversion. A final package-smoke run also passed both installed JavaScript APIs (`convert` and `convertSync`).
- The package smoke also ran native conversions in a macOS sandbox denying all writes to the selected extraction path. No extraction directory was created. This tests bundle independence, not every WorkBuddy policy.
- Deckuse preflight with a real Playwright browser passed. The installed runtime produced PPTX (1280×720) and DOCX (816×1056) PNGs through deckuse.
- Against the old installed 0.6.2 single-file converter using its existing cache, both sample page screenshots were pixel-identical. The PPTX fixture reported existing unresolved-font warnings in the test environment; this is not native Office fidelity certification.

Local artifacts: `../deck2html/artifacts/runtime-package-GS2zsc/` contains package-test results, installed packages, per-format command JSON and screenshots. The final CLI/API package-smoke artifacts are in `../deck2html/artifacts/runtime-package-fu3oXZ/`. Artifacts are ignored by Git and retained for inspection.

## Release gates still outstanding

The four-platform `runtime-package.yml` workflow has been added but was not run remotely. Windows x64, Linux x64 and macOS x64 execution, plus the original WorkBuddy policy, remain unverified. The local .NET build also reported existing ImageSharp 3.1.12 NuGet advisory warnings; dependency remediation is outside this change.

Do not publish the currently versioned 0.6.2 payload over the existing release. Assign a new deck2html version using its version script, run the four-platform package tests and release that version first. Then raise deckuse's `@deckflow/deck2html` minimum to the published version and regenerate the package-manager lockfile. The current dependency/lockfile deliberately remains installable against the existing registry; the new runtime was exercised via `DECKUSE_DECK2HTML_BINARY`. No registry publishing was performed.

For target-host verification, fix the user, policy, input, binary hash and environment; compare CLI and deckuse with distinct test outputs. Preserve user caches. Do not cycle directories or repeat equivalent denied operations. Report converter startup, browser launch and cleanup independently.
