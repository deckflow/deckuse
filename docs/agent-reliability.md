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
The only pipeline is Office → deck2html → HTML/Chrome screenshot. Successful
pages survive failures of other pages; the aggregate result is unsuccessful if
any page fails. Retry only failed pages. Single-page `--page/--output` remains
supported. Batch selectors cannot be combined with those options.

HTML defaults to the matched Playwright headless shell; system Chrome/Edge are explicit providers.
The former --engine option is removed and returns RENDER_ENGINE_REMOVED with migration guidance.
Remove that option and use render --preflight; there is no LibreOffice render or fallback.
Dependencies are not installed automatically.
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

## Browser provider and host execution contract

`deckuse render --preflight --json` is static: it checks configuration, explicit
executable permissions and temporary profile writability, without opening a GUI
or downloading anything. Managed browser installation and system-channel
availability remain unprobed until launch. Default provider is Playwright's matched
headless shell; run this installation's `node_modules/playwright-core/cli.js
install chromium --only-shell` if absent. Do not substitute a different Playwright
version's installer. System compatibility remains unverified.

Set `DECKUSE_BROWSER_PROVIDER` to headless-shell, chrome, msedge, chromium or
executable. The latter requires PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (legacy
CHROME_PATH/CHROMIUM_PATH also accepted). There is no automatic provider fallback.
A host that cannot permit browser execution sets DECKUSE_BROWSER_EXECUTION=denied
before invoking Deckuse: BROWSER_HOST_DENIED occurs before process launch. The
host can instead dispatch the same command through its approved worker; Deckuse
does not attach to daily browser profiles or grant itself permissions.

BROWSER_NOT_FOUND, BROWSER_LAUNCH_FAILED and BROWSER_HOST_REGISTRATION_FAILED
distinguish missing binaries, general launch failure and recognized registration
failure signatures (the latter does not prove a permission root cause). Launch
logs are private temporary files named in error.details, with provider/stage and
reported exit status. RENDER_CONVERSION_FAILED, RENDER_PAGE_LOAD_FAILED and
RENDER_SCREENSHOT_FAILED identify later stages. In-process failures are cached by
configuration/context; set DECKUSE_BROWSER_CONTEXT when host context changes or
DECKUSE_BROWSER_RETRY=1 for an explicit retry after remediation. Separate CLI
processes cannot share this memory; hosts should retain failed provider outcomes
for the task rather than relaunching unchanged commands. Batch keeps one browser
and isolated contexts; it does not relaunch per page. No --no-sandbox workaround
or LibreOffice fallback is used. Catching an error cannot undo an OS crash dialog.

## Task capability context

`agent-context --format pptx --scenario create --json` returns static identity,
adapter capabilities, skill resource locations, cache fingerprint, execution
conventions, browser preflight and an executable smoke recipe. Use --include-schema
for reachable task contracts in the same response, or retrieve them once later.
JSON operation contracts are separate from recipe.cli shell syntax. Capability
flags are taken from the same adapters as status; schemas do not override edition,
format, protected-target or data restrictions. Chart creation without a new embedded
workbook and conditional existing constant-cell updates remain distinct flags.

--workspace reads only format/current revision from its manifest; it does not
load object text or inventory or run validation/transaction recovery. Dynamic
health is explicitly not-probed. Refresh revision, health, inventory and environment
for each operation rather than caching them with the static fingerprint. Cache by
binary path/build plus version/protocol/edition/format/scenario/fingerprint.
The fingerprint includes actual task schemas/capabilities, so a changed build
invalidates it even without a product version bump. No browser is launched or
downloaded, and no document is created by this command.

Measured deterministic smoke: one agent-context response with --include-schema
provides the new/apply/validate/render/export command forms and operations. Tests
execute new/apply/validate/export from it without extra help/schema calls; real
render smoke is reported separately. This establishes legal commands, not model
first-write accuracy or a measured task-time improvement. Older CLIs without
agent-context use the same-version installed skill and targeted schema; do not
retry unknown commands indefinitely.

## Font and text risk reports

Render results include fontReport with per-object explicit font names, package
theme candidates, unresolved inheritance, CJK flags, converter resolver warnings
and text-content evidence. FONT_UNRESOLVED means deck2html could not resolve a
family in that conversion scope (possibly an unused theme candidate), not proof
that the operating system lacks it. Matched explicit families carry object targets;
theme inheritance/actual substitution and per-glyph coverage remain unknown.
CJK_FONT_INHERITANCE_UNVERIFIED and CJK_GLYPH_COVERAGE_UNVERIFIED identify review
work without changing font choices. FONT_INVENTORY_UNAVAILABLE keeps failures
honest. No fonts are installed automatically.

For PPTX, input paragraph text is compared with browser innerText before the
screenshot. RENDER_TEXT_CONTENT_UNVERIFIED is a heuristic review item, not proof
of missing pixels: bullet formatting, hidden content or conversion may differ.
text-found means input text is present in DOM, not that glyphs are correct,
visible or unclipped. DOCX inventory covers the whole document; correspondence to
HTML pages is unknown and text comparison is not claimed. fontVerification stays
unknown and nativeVerification unverified even when PNG generation succeeds.
Check chosen/fallback fonts on the renderer and Office hosts, inspect affected
pages and perform native review when required. Font availability, glyph coverage,
DOM completeness, screenshot success and visual approval are separate states.

## Apply reviewed layout corrections to an existing revision

Read `validate --render --json` or `export --report ./layout.json --json`. Layout
findings include `details.target` (or both `details.targets` for overlap) in
the same `slide:N/shape:ID` syntax accepted by writes. Bounds and height excess
are in EMU. Overlap width and height are in EMU and area is in square EMU.
`heuristic: true` indicates estimated overflow or overlap that needs review.

For example, after confirming the targets in the current report, save a batch
like this and substitute the current revision and desired geometry.

```json
[
  {
    "type": "setProperties",
    "target": "slide:1/shape:3",
    "properties": { "insets": { "top": "4px", "bottom": "4px" } }
  },
  {
    "type": "xfrmSet",
    "target": "slide:1/shape:3",
    "height": "130px"
  },
  {
    "type": "xfrmSet",
    "target": "slide:1/shape:4",
    "x": "30px",
    "y": "250px"
  }
]
```

Run `deckuse apply --workspace ./ws --input ./corrections.json --expect-revision 2 --json`,
then re-export to a new output and report path. Compare the affected findings
and inspect the updated slide. A warning may describe intentional geometry.

## Measure packed PPTX creation

After building, run `node scripts/benchmark-packed-pptx.mjs ./packed-benchmark.json 8`.
Use `12` for the larger fixture. The benchmark records a fresh-cache install and
three process-cold runs, with separate context, creation, validation, first export
and incremental export wall times. Set `DECKUSE_TIMINGS_FILE` to a writable JSONL
path to collect nested CLI phase spans without changing stdout. Phase spans can
overlap, and local measurements exclude host scheduling and visual review.

## Carry a PPTX review forward after a local patch

Start from the installed [two-slide starter](../skills/deckuse/examples/create-blank-pptx.json).
Create with `new --blank` and retain the original operation file. Render the baseline
with `render --all --workspace ./ws --output-dir ./review --json > baseline.json`.
Review both pages. Record the reported revision and keep the PNGs and sidecars in
the same directory.

Save an ordered patch, for example:

```json
[{ "type": "setText", "target": "slide:2/shape:Title", "value": "Reviewed details" }]
```

Apply it with `--request-id review-1 --expect-revision 2` and retain the response.
Run one `render --since-revision 2 --workspace ./ws --output-dir ./review --json > review.json`.
The batch maps the changed visual inputs to the pages that need fresh screenshots.
Each reused page includes `reusedFromRevision`. Failed pages remain explicit and
a failed render exits nonzero. Shared package changes, slide ordering changes and
missing or replaced PNGs invalidate the corresponding cache entries. Review fresh
screenshots and check the exported revision against the new inventory.

Replay by applying the original operations and the same ordered patches to a
fresh blank workspace, using the preceding revision as each guard. Compare slide
order, editable shape text, and validation results. Package bytes can differ
because the workspaces record independent build metadata.

For host-level wall-time trials see the [managed PPTX benchmark](managed-pptx-benchmark.md).
