# Create a new presentation

Use when the desired result is a new narrative/design from a topic, outline or source material. If preserving the appearance of supplied pages is central, use [Replicate](replicate.md). Use [Populate](populate-template.md) for repeated template fields.

Required modules: [CLI context](../modules/cli-context.md), [Typography/layout](../modules/typography-layout.md), [Verification/recovery](../modules/verification-recovery.md). Load [Charts/tables](../modules/charts-tables.md) only for data objects.

1. Establish audience, purpose, inputs, output location and approximate length from context. Ask only for a missing decision that matters. Separate sourced product facts from assumptions; retain references for claims and numbers.
2. Outline the story and decide slide dimensions, grid, palette, typography and content density once. If a template was supplied, inspect it; use the existing-file preservation workflow rather than inventing its brand.
3. Reuse the confirmed absolute CLI path across jobs; do not copy `node_modules`. When the request selects Deckuse, use this workflow from the installed package. For installation, use the scoped `@deckflow/deckuse` package and resolve latest once before pinning the exact version. Do not claim latest if resolution failed. Avoid unrelated authoring-tool tutorials and full README/schema scans. Run `deckuse agent-context --format pptx --scenario create --json` once and use the operation index and recipe. Load a targeted schema only when a nested field needs clarification.
   Research and independent environment preparation may run concurrently; keep blocking install polling out of the same batch as independent reads. On a follow-up, inspect the existing authoring script and retain suitable helpers, changing only content, colors and required geometry. Do not force an unsuitable layout to fit new content. Do not generate another custom layout checker or HTML preview; use validation and actual PPTX rendering.

4. Once operations and expected slide names are saved, prefer the installed
   generation runner described below. It captures process results and checks the
   resulting artifact. Use individual CLI calls when editing an existing workspace
   or diagnosing a failed phase; do not rediscover the full protocol schema.

   If the delivery needs a visual review, run `deckuse render --preflight --probe-browser --json` before authoring. A static preflight does not prove the browser can launch. Use an explicitly configured browser in the host-approved execution context.

   Copy or adapt the installed [two-slide starter](../examples/create-blank-pptx.json) to `ops.json`. Save the operation file, request ID and expected revision together before the first apply. Run each command separately. Require exit zero and JSON `ok: true`, plus explicit `data.valid: true` on validate and export. A pipe that prints `ok` does not enforce these checks. Use `list slides` for presentation order, never the numbering of XML files.

   ```sh
   deckuse new ./ws --blank --json
   ```

   ```sh
   deckuse apply --workspace ./ws --input ./ops.json --request-id create-1 --expect-revision 1 --summary --json
   ```

   ```sh
   deckuse validate --workspace ./ws --expect-revision 2 --summary --render --report ./validation.json --json
   ```

   ```sh
   deckuse export ./presentation.pptx --workspace ./ws --revision 2 --json
   ```

   The blank slide is named `Blank starter`. Give new slides unique names and reference them by name. The commands assume the initial apply changed the deck and returned revision 2. Use the actual returned revision for validation and export.

5. For diagrams, quantitative charts and tables, load [Native drawing](../modules/native-drawing.md). Use targeted schema queries only for operations missing from the create context.
6. Check page count, titles, native object inventory and all first-pass renderings using [Quality review](../modules/quality-review.md). Collect defects before editing. Write one patch batch with stable targets, such as the following JSON array, using the revision returned by the original apply.

```json
[{ "type": "setText", "target": "slide:1/shape:Title", "value": "A shorter title" }]
```

```sh
deckuse apply --workspace ./ws --input ./patch.json --request-id polish-1 --expect-revision 2 --summary --report ./polish-attempt-1.json --json
```

Run validation and render after checking the apply response.

```sh
deckuse validate --workspace ./ws --json
deckuse render --since-revision 2 --contact-sheet --workspace ./ws --output-dir ./review --json
```

Export after reviewing the preview. Use the returned revision in place of `3` if it differs.

```sh
deckuse export ./presentation-rev3.pptx --workspace ./ws --revision 3 --json
```

Keep the same output directory to reuse unchanged pages. Review newly rendered pages and use the combined contact sheet for context. Verify Chinese line breaks and any suspected clipping at readable size. A CJK orphan-line note is a heuristic, not a blocker on its own. For intentional geometry, pass `--review-notes ./notes.json` with entries such as `{"code":"OBJECT_OUT_OF_BOUNDS","targets":["slide:1/shape:5"],"reason":"Intentional full-bleed background"}`. This adds a reason to the matching diagnostic while retaining the visual evidence. A reused page identifies its original revision. If the apply response is missing, query `deckuse status --workspace ./ws --request-id polish-1 --json` before another write. Reuse the ID and exact input only when recovering that same request, and stop on conflicts. If the lock blocks status, use `status --read-only --request-id polish-1` for diagnosis and preserve the workspace. An uncertain observation does not authorize a retry.

7. Deliver the PPTX and report the actual verification states, selected font strategy and remaining native review. Do not use an entire-slide bitmap as an editable design substitute.

### Rebuild as a new generation

Use a revision-guarded patch for local changes. For a full replacement, run
`node <installed-package>/scripts/rebuild-generation.mjs ./job ./ops.json
./expected-slide-names.json`. The output root must exist. Each run creates a
separate generation with its own
workspace, exported PPTX and reports. Add `--preview` to render into that
generation's preview directory and check the page inventory against the export.
A failed generation leaves all earlier workspaces and deliverables intact. The runner writes `run.json` and separate process results. Treat `preview-ready` as screenshots available for review and `preview-blocked` as structural delivery with visual review outstanding. For `preview-blocked`, follow `nextAction` to deliver the validated PPTX and report visual and native review as pending. Resume with `--retry-preview` only after confirming the required host capability has changed. The runner will not start another preview from a nonretryable checkpoint without that explicit flag.

### Default delivery and continuation

Once operations and ordered unique slide names are saved, prefer the installed
`scripts/rebuild-generation.mjs` runner for new presentations as well as full
replacements. Create the output root once, then run the documented command above.
Workspace cleanup moves owned artifacts into `.deckuse-trash/` by default.
Use `--resume <generation-directory>` after correcting a failed environment phase;
it checks saved inputs, live revision, receipt and artifact digests before continuing.
Do not clear host-injected `NODE_OPTIONS`, delete locks, repeat writes after an
unknown result, or try equivalent operations after a policy refusal.

Use `validate --summary --render --report <new-file> --json` for ordered slide
inventory, text targets and heuristic findings. Never infer presentation order
from slide XML filenames. Review actual PPTX PNGs and the contact sheet; do not
substitute HTML drawn from operations for artifact verification. Inspect all
first-pass pages, batch local corrections, then render changed pages using the
existing `--since-revision` workflow. A runner's `preview-ready` is not visual approval.

### Keep the reviewed result reproducible

If polishing changed content, update the authoring source or retain an ordered
base-plus-patches recipe. Rebuilding only the original ops file loses the edits.
The existing runner accepts repeatable `--patch` inputs (JSON arrays of high-level
operations), saves their bytes and digests, and compiles them in order into one
atomic apply. No additional revision is required for each patch in a fresh build.

```sh
node <installed-package>/scripts/rebuild-generation.mjs ./job ./ops.json ./expected-slide-names.json --patch ./patch.json --assert-text ./assertions.json --preview
```

`assertions.json` is an array such as
`[{"text":"Final title","count":1,"slide":1},{"text":"Old title","count":0}]`.
Counts are matching text objects, not substring occurrences. A missing page or a
malformed assertion is a failure. Resume verifies saved inputs before continuing.
For a live revision-guarded patch, validate the same assertions in one snapshot:

```sh
deckuse validate --workspace ./ws --expect-revision 3 --assert-text ./assertions.json --summary --json
```

Read `data.matchSummary` after apply and `data.textAssertions` after validation.
Search returns `data.matches`; list returns `data.items`. Never default a missing
required response field to an empty array. `replaceText` reports changed targets
and per-operation counts in the full report. Reflowing a slide must not remove
qualifiers or strengthen claims merely to save space; consider box/layout changes.

A structural pass does not establish font availability or native Office fidelity.
Keep structure, preview, visual review, font and native verification distinct in
handoff. Deliver after the required checks; retain machine reports for details.
