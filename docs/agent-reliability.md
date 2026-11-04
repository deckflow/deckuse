# Agent reliability and batch workflows

Protocol remains 2.0. These changes retain Community format and edition boundaries.

## Safety changes

`new`/`init` now reject every nonempty destination with `WORKSPACE_NOT_EMPTY`.
Use an absent or empty folder, or continue editing an existing workspace. No
force-overwrite mode is provided. Initialization reserves the destination against
competing initializers and cleans its own partial output on ordinary failure.

PPTX and DOCX persistence backs up the actual working files before replacing
source, snapshot, index, manifest, operation log and Git index/refs. This preserves
uncommitted manual edits on rollback. A failed Git commit is an error, never an
implicit permission to write without history. Unreachable Git objects may remain;
they do not create a successful revision.

A journal in `.deckuse/transaction/` identifies interrupted writes. The next
workspace access holds the workspace lock while checking recovery. A matching
transaction commit and target file digest finalize a completed write; otherwise
backups are restored. Invalid/missing backups or an unverifiable changed HEAD
return `RECOVERY_REQUIRED` and retain evidence. Preserve this directory for
recovery; do not delete it to bypass the error. Process-interruption recovery is
not a guarantee against disk hardware failure or loss of the backup directory.
`status.data.health` reports the actual Git commit and available undo steps.

## Machine interface

Ordinary `--json` commands return one stdout JSON envelope on success or failure.
CLI input errors exit 2; operation failures exit 1; success exits 0. Help/version
remain textual display commands. Host-injected output and process termination
cannot be guaranteed to produce JSON. Capture stdout, stderr and exit code
separately. Never parse merged `2>&1` as JSON. After a timeout or parser failure,
read status/history/inventory before retrying a mutation.

`schema --list --json` lists command and batch types. `schema --type addShape
--json` includes only reachable definitions. `schema --command add` is rejected
with a correction. `apply` already supports `addSlide`; build pages and contents
in one batch. See the bundled create-deck recipe. Slide names are saved in OOXML;
new-page results include their final page index, target, UID and part URI.

## Rendering and capability boundaries

`render --pages 1,3-5 --output-dir ./review --json` and `render --all` capture one
package snapshot. HTML rendering reuses a browser while converting each page.
LibreOffice converts once to PDF before rasterizing selected pages. Successful
pages survive failures of other pages; the aggregate result is unsuccessful if
any page fails. Retry only failed pages. Single-page `--page/--output` remains
supported. Batch selectors cannot be combined with those options.

HTML needs Chrome/Chromium/Edge. LibreOffice needs soffice, pdfinfo and pdftoppm.
Dependencies are not installed automatically and engines are not silently changed.
Render results report engine, input digest, revision and pending native/font
verification. Structure validation, approximate rendering and native Office review
are separate delivery states; screenshot generation alone is not visual approval.

`autofit: resize` writes an Office auto-fit instruction, not a measured text height.
New charts do not include an embedded workbook. Existing supported constant-cell,
fixed-length A1 workbooks can be synchronized with chart caches and isolated when
shared. Formula dependencies and resizing remain refused. Combo secondary axes
are supported; generic stacked chart creation remains outside this change.

## Evidence corrections from the WorkBuddy reports

The reviewed 1.5.0 repository already supports batch addSlide, resize autofit and
combo secondary axes. `export` requires a path; “default” described rebuilding.
The missing ensure_deckuse script belonged to an external replicate skill.
The broker-skipped Git warning does not exist in either reviewed source version;
attribute it only after inspecting the installed package and host wrapper.

Seven “add failed” lines were parser failures after stderr was merged, and the
following inventory proves those pages existed. Treating their timeout as a failed
write caused an extra page and cleanup. Do not label all timeout time as wasted.

The transcript supports an explicit rm before the first new call, but does not
prove a half-built directory existed or explain two approval dialogs. Two-stage
approval, automatic deletion never prompting and a zero-dialog guarantee remain
unverified without client approval logs. Use a new directory to avoid unnecessary
explicit deletion.

Tool-call gaps are not exclusively model reasoning time. Sum concurrent intervals
by their union when reporting wall-clock occupation. The timeline's Token chart
averages totals across tools; it is not per-request usage evidence. Missing raw
usage and truncated outputs cannot support exact attribution. No 6–9 minute
completion promise follows from this session.

## Reproducible benchmark

After building, run `node scripts/benchmark-agent-workflow.mjs /tmp/benchmark.json
--render`. It uses eight pages and 135 content operations, five process-cold and
five preloaded iterations, comparing 142 separate write processes with one batch.
Cold does not mean an evicted OS cache. Raw records, environment and median build
times are saved after every case. Rendering failures are retained as failures.

`DECKUSE_TIMINGS_FILE` optionally records index, mutation, pack, Git, conversion
and screenshot spans as JSONL. Spans may be nested; do not add them to wall time.
The startup probe is separate. Agent scheduling and approval waits are not measured
by this local CLI benchmark and must be supplied by a host trace when available.

The matrix runner `node scripts/run-agent-benchmark-matrix.mjs /tmp/bench` executes
three cases concurrently, then saves all twenty build samples. Its results include
resource contention and must not be described as isolated-machine measurements.
`node scripts/summarize-agent-benchmark.mjs /tmp/bench/results.json` reloads complete
phase traces, computes interval unions, and compares single/batch HTML PNG bytes.
Matching previews establish renderer consistency, not native Office fidelity.

See [verification results](verification-agent-reliability.md) for checks, measured samples and their limits.

## Revision compatibility contract (protocol 2.0)

The top-level CLI envelope `revision`, when present, is a nonnegative safe integer
projection. `data.revision`, workspace manifest revisions, SDK results and
`history.data.records[].revision` retain their existing decimal string type.
These fields describe the same workspace counter but are deliberately different
serialization contracts; do not compare them directly with `===`. History has no
single current envelope revision. No manifest/history migration is required.

Use the exported `revisionAsNumber` from `@deckflow/deckuse` for numeric comparison:

```js
import { revisionAsNumber } from '@deckflow/deckuse';
const sameRevision =
  revisionAsNumber(response.revision) === revisionAsNumber(response.data.revision);
```

Only compare defined normalized values; unknown/legacy opaque revisions normalize
to undefined, not zero. Noncanonical strings, fractions and unsafe integers are
rejected. The normalization helper now consistently enforces this on both number
and string input. Preserve the raw workspace revision for write guards:
`--expect-revision 2` passes the decimal CLI argument as a string. JSON
`expectRevision` is also string typed. A stale guard fails rather than overwriting
newer content. Existing clients depending on string SDK/manifest/history values
remain compatible; a future unified wire type would require a versioned migration.
