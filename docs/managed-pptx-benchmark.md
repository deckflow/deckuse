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
