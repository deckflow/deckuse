# Create a new presentation

Use when the desired result is a new narrative/design from a topic, outline or source material. If preserving the appearance of supplied pages is central, use [Replicate](replicate.md). Use [Populate](populate-template.md) for repeated template fields.

Required modules: [CLI context](../modules/cli-context.md), [Typography/layout](../modules/typography-layout.md), [Verification/recovery](../modules/verification-recovery.md). Load [Charts/tables](../modules/charts-tables.md) only for data objects.

1. Establish audience, purpose, inputs, output location and approximate length from context. Ask only for a missing decision that matters. Separate sourced product facts from assumptions; retain references for claims and numbers.
2. Outline the story and decide slide dimensions, grid, palette, typography and content density once. If a template was supplied, inspect it; use the existing-file preservation workflow rather than inventing its brand.
3. When the request selects Deckuse, use this workflow from the installed package. For installation, use the scoped `@deckflow/deckuse` package and resolve latest once before pinning the exact version. Run `deckuse agent-context --format pptx --scenario create --json` once and use the operation index and recipe. Load a targeted schema only when a nested field needs clarification.
4. If the delivery needs a visual review, run `deckuse render --preflight --probe-browser --json` before authoring. A static preflight does not prove the browser can launch. Use an explicitly configured browser in the host-approved execution context.

   Copy or adapt the installed [two-slide starter](../examples/create-blank-pptx.json) to `ops.json`. Save the operation file, request ID and expected revision together before the first apply. Run each command separately. Require exit zero and JSON `ok: true`, plus explicit `data.valid: true` on validate and export. A pipe that prints `ok` does not enforce these checks. Use `list slides` for presentation order, never the numbering of XML files.

   ```sh
   deckuse new ./ws --blank --json
   ```

   ```sh
   deckuse apply --workspace ./ws --input ./ops.json --request-id create-1 --expect-revision 1 --summary --json
   ```

   ```sh
   deckuse validate --workspace ./ws --expect-revision 2 --json
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
./expected-slide-names.json`. The output root must exist and allow the script's
internal retirement moves. Each run creates a separate generation with its own
workspace, exported PPTX and reports. Add `--preview` to render into that
generation's preview directory and check the page inventory against the export.
A failed generation leaves all earlier workspaces and deliverables intact. The runner writes `run.json` and separate process results. Treat `preview-ready` as screenshots available for review and `preview-blocked` as structural delivery with visual review outstanding. After an error marked `retryable: false`, stop preview attempts until the host configuration changes.
