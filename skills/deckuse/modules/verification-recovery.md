# Verification and recovery

## After a mutation

1. Check process exit and envelope/error diagnostics. Record revision and changed targets/parts. A failed JSON parser is not evidence the write failed.
2. Read current status and the affected inventory. Verify exact slide/page counts and expected text/data; reconcile an uncertain response before retrying.
3. Run structural validation and examine `data.valid` and diagnostics. Export to a new explicit path; check the export result too.
4. For PPTX visual delivery, batch-render all delivered pages with HTML/Chrome and use [Quality review](quality-review.md) on the actual images, including individual text/data-heavy pages. Retry only failed pages after fixing the cause. If visual tools are unavailable, retain an explicit pending state.
5. For edits, compare changed parts and relationships against the no-edit baseline. Check untouched slides/assets. Native Office opening/visual/editability checks are additional states, recorded only if performed.

```bash
deckuse validate --workspace ./ws --json
deckuse render --workspace ./ws --all --output-dir ./review --json
deckuse export ./output.pptx --workspace ./ws --json
```

If manual source edits make the snapshot stale, export/rebuild before rendering the package snapshot. In 1.8.0 DOCX can use Deckuse HTML page rendering; earlier 1.7.0 rejected it. HTML pagination is approximate and is not native Word pagination. Use available Word/native tools for native layout claims. Do not replace the HTML path with LibreOffice automatically.

Structure-valid, preview-generated, visual-reviewed, native-opened, native-visual-reviewed and editable-objects-checked are independent states. Record backend/input digest/font uncertainty and which pages were actually viewed. No universal “all clear” follows from a screenshot or an enabled capability flag. Heuristic overflow/overlap is a review cue; intentional decorations can trigger it.

## Failure handling

- Missing browser: preserve raw launch diagnostics, check configured executable and host capabilities, explain the missing dependency. A found browser that crashes is different from an absent executable. Do not keep launching the same failing provider or bypass the host's controls.
- HTML navigation/readiness timeout: preserve the page error and inspect current status plus the input revision/digest. A `page.goto`/`networkidle` timeout after conversion is not a failed document write, a missing browser, or proof of corrupt content. Keep the PPTX and successful screenshots. If the state is clean and failure may be transient, make one bounded retry of the failed page from the same snapshot, saving it as a separate attempt. If the same failure recurs, stop that retry loop and diagnose the loading/resource cause; do not rebuild content, change engines or claim visual completion.
- Unexpected input/target: inspect the saved contract/current inventory, correct the bounded operation, then retry once the reason is resolved. Do not overwrite the full deck to fix one target.
- Git/commit or persistence error: verify rollback using status/history/content. `health` describes actual history; a revision number alone is not recoverability proof.
- Interrupted write: next access may recover a journaled transaction. Preserve `.deckuse/transaction/`; `RECOVERY_REQUIRED` is a stop-and-report state, not an instruction to delete evidence.
- Undo changes state and can discard intended revisions. Use only within an authorized recovery/iteration scope, inspecting history and the requested steps first.
- Repair is a mutation. `NOTES_SLIDE_MISMATCH` may have a supported narrow repair; ambiguous relationships require diagnosis. Do not auto-repair while performing a read-only audit.

## Resume a multi-phase task

Retain the input hash, planned operations, completed outputs, last observed revision and each process result. Before reusing a completed step, confirm its relevant output and workspace state still match; a successful exit from an earlier session does not prove the file has not changed since. Use fresh status/inventory after outside edits or an uncertain mutation.

Resume the first incomplete phase, not the whole pipeline. For example, successful apply/validate/export followed by a failed render needs render recovery, not another addSlide/apply. For multi-record templates, resume only incomplete records using independent workspaces. Give each failed/retried process its own stream files; preserve the initial error instead of overwriting it with the successful retry.

Finish with the output file, completed checks, known limitations and any unresolved user action. Keep operation files, streams and a small evidence index with the task; avoid credentials and unrelated private file content in shareable reports.

### Recover a PPTX apply response

Give each logical apply a stable `--request-id` and the inspected `--expect-revision`. Save the result to a fresh report file. If the process times out, stdout closes, or a shell command loses the response, run `deckuse status --workspace ./ws --request-id <id> --json`. A committed receipt reports its original revision, and `current` reports whether it still matches the current write history. Reuse the ID and the same input for a retry only when continuing that request. Treat stale receipts and conflicting inputs as a reason to inspect the current state before making another write.

If a render logs `RENDER_CLEANUP_FAILED`, check the screenshot result and the reported temporary directory separately. Preserve successful PNGs. A denied cleanup path does not require another apply or conversion. If the converter itself reports `RENDER_CONVERTER_EXTRACTION_FAILED`, use `render --preflight` with an allowed writable extraction directory, then resume rendering.

A `not-committed` receipt records a definite rejection. Use a new request ID for
corrected input. A `reverted` receipt identifies a write undone in this workspace.
An `unknown` result has no receipt, so reconcile status, history and the current
revision before any guarded retry. A later successful write does not erase the
original receipt of an earlier commit that remains in history.

### Managed authorization and pre-delivery checks

Before a host asks to authorize a write, persist its logical request ID, exact
operation file and expected base revision in the job. Re-invocation after
authorization must reuse that tuple. If the result is missing, query the receipt
with `status --request-id` before another write. A new logical edit receives a new
ID and current base revision even if its content matches an earlier edit.

Before preview or export, run `validate --expect-revision 2 --expect-slides 2
--expect-slide-names ./expected-names.json --workspace ./ws --json`. The name
file is an ordered JSON array of unique slide names. Use the actual expected
inventory and the revision returned by apply. Stop on a mismatch. Pin export
with `--revision 2` and compare preview's revision and page inventory to it.

For a host that approves moving Deckuse-owned internal artifacts, set
`DECKUSE_CLEANUP_MODE=retire` before authoring. Routine lock and journal release
then moves retired entries into the workspace's `.deckuse-trash/` without a
delete attempt. This leaves an auditable directory that can grow over time.
If release fails, keep the committed response and its cleanup warnings.
Leave unknown or live locks in place. A claim left by interrupted stale-lock
retirement can require host intervention, so preserve it and report the state.
