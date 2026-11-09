# Managed-agent editable PPTX benchmark

Use the same named host, model, approval settings, browser policy, package version,
and brief for each trial. Record the exact npm version under test. Run three cold
and three warm trials in independent empty workspaces. Start the clock when the
host accepts the prompt. The five-minute target is 300 seconds to reviewed handoff.

## Fixed production brief

> Create an editable eight-slide PowerPoint for the fictional product Harbor Desk
> 海港工作台. Attach the PPTX and use Deckuse. The product organizes support
> handoffs into one queue with a named owner, next action, and deadline. Its
> audience is a bilingual customer-support lead considering a pilot. Cover the
> problem, product overview, intake, ownership, deadline alerts, escalation, pilot
> checklist, and the call to action. Use the supplied facts only, with a light
> background and editable Chinese and English text. Check all slides for clipping,
> legibility, and overlaps before handoff.

The cold path installs the pinned package in an empty project with a fresh npm
cache. The warm path starts with that package installed and a fresh authoring
workspace. Both paths start with the brief and create operations in the host.
For a separate control, replay a previously saved base operation file and its
ordered patches. Keep control runs out of the production success fraction.

## Evidence to save

Save one JSON object per trial. Times are elapsed seconds from prompt acceptance.
Use null for a milestone that did not occur. Keep the initial operations,
ordered patches, validation output, export envelope and page review inventory.

```json
{
  "host": "named managed host and version",
  "model": "model identifier",
  "packageVersion": "exact npm version",
  "condition": "cold",
  "mode": "production",
  "trial": 1,
  "scenario": "normal",
  "milestones": {
    "installed": null,
    "contractReady": null,
    "firstOperations": null,
    "writeComplete": null,
    "firstValidatedExport": null,
    "firstPreview": null,
    "patchComplete": null,
    "visualReviewComplete": null,
    "attachmentAvailable": null
  },
  "toolCallIntervals": [],
  "failedCalls": 0,
  "fullRebuilds": 0,
  "outcome": "incomplete",
  "cliTimingFile": null
}
```

Record tool intervals as pairs of start and end seconds. Merge overlaps before
summing tool wall time. Uncovered wall time is elapsed trial time minus that
union. Record each failed call and classify any full rebuild. Set
`DECKUSE_TIMINGS_FILE` for CLI phase spans and keep those alongside host intervals.

A reviewed handoff requires a reachable attachment, successful structural
validation, editable content, and recorded visual review of every page for the
three checks in the brief. Its timestamp is the later of visual review and
attachment availability. A validated artifact without completed preview is
`preview-blocked` or `structural-only` and counts separately from reviewed handoff.
Report each trial and the reviewed fraction at or below 300 seconds, grouped by
condition. Keep successful and failed trials in the denominator.

Run one additional trial with `DECKUSE_BROWSER_EXECUTION=denied`. Complete new,
apply, validate and export, attach the artifact, and record `preview-blocked` with
no visual-review timestamp. The trial passes the classification check if it
records a usable structural artifact and does not count as reviewed handoff.

## Local 9-slide control replay

Run the same generated inputs through two built CLIs:

```sh
DECKUSE_BROWSER_PROVIDER=chrome node scripts/benchmark-managed-replay.mjs \
  /path/to/baseline/dist/bin.js /path/to/candidate/dist/bin.js /new/report.json --preview
```

The replay uses 199 operations and 189 editable text boxes, then patches one
page in the same workspace. It verifies page order, export digest, preview
revision, and reuse of the eight unchanged pages. Omit `--preview` to
measure the structural workflow alone. The report retains failed trials and
CLI traces. The uncovered time is host/model time without finer attribution
when measured in a real host. In this replay it is local runner overhead.

| Build                          | Trial 1 | Trial 2 | Trial 3 |  Median | Preview ready |
| ------------------------------ | ------: | ------: | ------: | ------: | ------------: |
| 1.9.4 release commit `d6ca3bf` | 17.29 s | 11.13 s | 12.45 s | 12.45 s |           3/3 |
| Candidate based on `b6982e0`   | 11.82 s | 11.17 s | 20.42 s | 11.82 s |           3/3 |

Local macOS, Node 24.14.1 and system Chrome. Builds used the same installed
dependencies. The spread across three trials does not establish a speedup.
The replay measures CLI work and local previews. WorkBuddy cold and warm
production trials, model latency, and the five-minute reviewed handoff
target remain unverified.

## Ten-slide workflow comparison

Use three builds: release commit `d6ca3bf`, pre-change commit `901f931`, and the
candidate commit (record dirty status if uncommitted). Version 1.9.4 alone does
not identify the build. For each build run at least three cold-install and three
warm-installed production trials **per brief type**, with the same named host,
model, permissions, browser, fonts and quality criteria:

- Fixed facts: create ten editable bilingual slides for the fictional Harbor Desk
  product using the facts in the fixed brief above. Split intake and escalation
  into two pages each to make ten pages. Include about 260 native objects, including editable text and diagrams.
  Use supplied facts only; do not browse. Record actual object count rather than
  adding meaningless decoration solely to reach the target.
- Research: create ten editable slides explaining a named product or topic using
  primary sources. Fix the same topic, evaluation date and source requirements
  across builds. Keep fact verification and citations in every condition. Record
  source availability and research time separately; do not compare a medical
  research task with a supplied-facts task as if they were equivalent.

For each condition report all samples, failure fraction, tool calls, median time
and verification state. The target is at least 30% lower median warm end-to-end
latency at equal quality/verification, not a guaranteed five-minute result. Three
samples do not establish a reliable P95. A blocked preview never counts as a
reviewed handoff. Retain failed trials in the denominator.

For a deterministic control (three process-cold replays per build, **not** actual
cold installs or production model trials):

```sh
node scripts/benchmark-managed-replay.mjs /release/dist/bin.js /candidate/dist/bin.js \
  /new/ten-slide-report.json --reference-cli /pre-change/dist/bin.js --scenario ten-slide
```

Add `--preview` only with the configured, permitted browser. This fixture has ten
pages and 260 editable text objects; it isolates CLI throughput rather than design
quality or research. It does not satisfy the production trial requirements above.

Analyze a WorkBuddy JSONL trace without copying private payloads into the repository:

```sh
node scripts/summarize-agent-benchmark.mjs --agent-log /private/session.jsonl /new/timeline.json
```

The result contains task boundaries, interval unions, incomplete calls and
attempt milestones. It does not infer success from a shell exit or mark visual
review from prose. Summaries and background notifications do not start tasks.
Unattributed wall time includes unknown model/host contributions. Simultaneous
result timestamps are marked batch-ambiguous and cannot identify the slow tool.

### Implementation verification — 2026-11-09

Local macOS arm64, Node 24.14.1, matched Playwright headless shell, deck2html 0.6.2.
Archived source trees for the two baseline commits shared the current installed
dependencies. Candidate means the implementation working tree during this task,
not a released package. Package installation was running concurrently, so these
are not isolated-machine latency samples. Later documentation, formatting and
context/summary refinements were covered by the final tests below.

| Build                  |  Trial 1 |  Trial 2 |  Trial 3 |   Median | Preview ready |
| ---------------------- | -------: | -------: | -------: | -------: | ------------: |
| Release `d6ca3bf`      | 10.620 s | 10.318 s | 10.233 s | 10.318 s |           3/3 |
| Pre-change `901f931`   | 10.265 s | 10.315 s | 10.233 s | 10.265 s |           3/3 |
| Candidate working tree | 10.318 s | 10.283 s | 10.443 s | 10.318 s |           3/3 |

The ten-slide control used 271 operations and 260 editable objects, followed by
one local text patch. All runs verified the exported package and incremental
preview inventory, including reuse of the nine unchanged pages. No meaningful
CLI throughput improvement is established by these samples; the intended gain
is fewer agent round trips and less recovery work.

Final verification completed:

- Build/type checking, changed-source ESLint, formatting and diff whitespace checks.
- Full Vitest suite: 64 files, 441 tests passed.
- Tarball install/resource/link checks, PPTX/DOCX smoke, compact validation and
  generation continuation passed. A second packaging run reused the first run's
  npm download cache; this is package validation, not a cold-install benchmark.
- Real-browser continuation: initially denied preview retained the export;
  after the execution context changed, resume produced two previews and a contact
  sheet without changing PPTX bytes. A further resume reused both page images.
- Private log analysis reproduced the warm task's 743826 ms elapsed time,
  19 tool calls, 122259 ms interval union and 621567 ms unattributed time. The
  private trace is not included in this repository.

WorkBuddy/CodeBuddy command entry points were unavailable in this environment.
The required real-host cold/warm production trials and the 30% reduction target
remain **unverified**. Preview generation in these checks is not human visual
approval or native Office verification.
