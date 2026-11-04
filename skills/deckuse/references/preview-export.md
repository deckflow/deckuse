# Preview and export PPTX or DOCX

Input: existing workspace or supported Office file. Output: requested preview images and/or independent Office export, with per-page and validity status. This task does not authorize content edits.

1. Reuse the workspace if given; otherwise preserve/hash the Office input and `init input.pptx ./ws --json` (or DOCX) in an absent directory. Inspect `status --workspace ./ws --json`, including packageStale and diagnostics.
2. Read installed `render --help` once for batch page selection/output syntax. Use its supported all/pages option; older versions use `render --page N --workspace ./ws --output ./page-N.png --json` for each requested page. Retain each page's success/failure and renderer metadata; do not silently drop failures.
3. On launch failure inspect browser availability/configuration using installed help and host tooling. After fixing the cause retry only failed pages. HTML/Chrome is the supported pipeline; do not add LibreOffice fallback. DOCX HTML page numbers may differ from Word.
4. Read verification-recovery. `export ./out.pptx --workspace ./ws --json` rebuilds source by default; `--from-package` only copies the snapshot and must not hide stale source. Use DOCX extension for Word. For delivery inspect schema for `--profile delivery`, validity and diagnostics; blocked chart verification remains unverified, not automatically repaired.

Deliver requested files with page outcomes, structural status, external layout inspection and native checks separately. If export/render fails, preserve inputs, report exact diagnostics and leave affected outputs unverified. Never turn preview-only work into a redesign or repair without task authorization.
