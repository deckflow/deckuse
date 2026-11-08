# Create a new presentation

Use when the desired result is a new narrative/design from a topic, outline or source material. If preserving the appearance of supplied pages is central, use [Replicate](replicate.md). Use [Populate](populate-template.md) for repeated template fields.

Required modules: [CLI context](../modules/cli-context.md), [Typography/layout](../modules/typography-layout.md), [Verification/recovery](../modules/verification-recovery.md). Load [Charts/tables](../modules/charts-tables.md) only for data objects.

1. Establish audience, purpose, inputs, output location and approximate length from context. Ask only for a missing decision that matters. Separate sourced product facts from assumptions; retain references for claims and numbers.
2. Outline the story and decide slide dimensions, grid, palette, typography and content density once. If a template was supplied, inspect it; use the existing-file preservation workflow rather than inventing its brand.
3. Load the installed context once. Choose an absent/empty workspace. `new` starts with a Title Slide; for freeform work replace it with an actual Blank layout inside the first batch.
4. Adapt [create-pptx.json](../examples/create-pptx.json). The sample builds a native background, heading and semantic bullet list. It deliberately does not assume a platform-specific Chinese font; select a suitable family for the user's target environment before multilingual delivery.

Use a fresh workspace and a fresh report filename for each invocation. Stop if setup or apply fails.

```sh
set -e
deckuse render --preflight --probe-browser --json
deckuse new ./ws --format pptx --json
deckuse apply --workspace ./ws --input ./ops.json --request-id create-1 --expect-revision 1 --summary --report ./create-attempt-1.json --json
deckuse validate --workspace ./ws --json
deckuse render --all --contact-sheet --workspace ./ws --output-dir ./review --json
```

Copy/adapt the bundled JSON into the task's `ops.json`. Give slides unique names and add all pages before operations that use their final positions. Use one logical transaction for the build. Structural validation runs before commit, so use dry-run only when previewing a proposed write. Keep its original result if you need to read it again. A dry-run cannot establish native layout quality.

5. For diagrams, quantitative charts and tables, load [Native drawing](../modules/native-drawing.md). Use targeted schema queries only for operations missing from the create context.
6. Check page count, titles, native object inventory and all first-pass renderings using [Quality review](../modules/quality-review.md). Collect defects before editing. Write one patch batch with stable targets, such as the following JSON array, using the revision returned by the original apply.

```json
[{ "type": "setText", "target": "slide:1/shape:Title", "value": "A shorter title" }]
```

```sh
deckuse apply --workspace ./ws --input ./patch.json --request-id polish-1 --expect-revision 2 --summary --report ./polish-attempt-1.json --json
deckuse validate --workspace ./ws --json
deckuse render --since-revision 2 --contact-sheet --workspace ./ws --output-dir ./review --json
deckuse export ./presentation.pptx --workspace ./ws --json
```

Keep the same output directory to reuse unchanged pages. Review newly rendered pages and use the combined contact sheet for context. Verify Chinese line breaks and any suspected clipping at readable size. A CJK orphan-line note is a heuristic, not a blocker on its own. For intentional geometry, pass `--review-notes ./notes.json` with entries such as `{"code":"OBJECT_OUT_OF_BOUNDS","targets":["slide:1/shape:5"],"reason":"Intentional full-bleed background"}`. This adds a reason to the matching diagnostic while retaining the visual evidence. A reused page identifies its original revision. If the apply response is missing, query `deckuse status --workspace ./ws --request-id polish-1 --json` before another write. Reuse the ID and exact input only when recovering that same request, and stop on conflicts.

7. Deliver the PPTX and report the actual verification states, selected font strategy and remaining native review. Do not use an entire-slide bitmap as an editable design substitute.

### Start with a blank slide

Use the [two-slide operations](../examples/create-blank-pptx.json) with a blank starter.

```sh
deckuse new ./blank-example --blank --json
deckuse apply --workspace ./blank-example --input ./create-blank-pptx.json --request-id blank-create-1 --expect-revision 1 --summary --json
deckuse validate --workspace ./blank-example --json
deckuse export ./blank-example.pptx --workspace ./blank-example --json
```

The first slide is named `Blank starter`. Give each added slide a unique name and use it as the `slide` value in `addShape` operations. The name is resolved against the live batch index, so inserts before that slide do not change the destination. Numeric indexes remain supported.
