# Verification and recovery

For existing files, hash/copy the original, inventory objects and export a no-edit baseline. Bound allowed changes before dry-run/apply; compare intended edits and unchanged content against the baseline, not raw ZIP byte equality. Preserve whitespace, ordering, relationships and shared media. Re-inventory after structural changes.

Run `validate --workspace ./ws --json` after edits. For referenced chart data use `--profile delivery` on validate/export; inspect schema first on older binaries. Unsupported formulas, external links or resizing remain unverified; do not edit caches to bypass refusal. Export can write an invalid file: inspect `data.valid` and diagnostics before delivery.

Render each delivered page via HTML/Chrome and inspect text completeness, overlap, crop and reference similarity. Native Office opening and visual review are separate checks. Record renderer, converter/input identity and fonts where available. HTML pagination for DOCX can differ from Word. Report structural validity, layout review, native open/visual review and native editable-object inventory separately, marking unavailable checks unverified.

For INVALID_COMMAND inspect error.message and diagnostics paths, then query targeted schema. For TARGET_NOT_FOUND refresh inventory; dry-runs cannot see names from a different uncommitted batch. NOTES_SLIDE_MISMATCH requires repair only when ownership is unambiguous; shared/unowned notes must not be guessed. Unsupported protected content requires a supported alternative within scope.

Capture stdout, stderr and exit status separately. After timeout or malformed JSON, inspect status/history/current objects before retrying. Undo only a confirmed unwanted revision with `undo --workspace ./ws --steps 1 --json`; retain original and baseline. If browser launch fails, diagnose executable availability with render help and host tooling; retry failed pages after fixing it. Do not introduce LibreOffice fallback or claim successful visual verification from a failed render.
