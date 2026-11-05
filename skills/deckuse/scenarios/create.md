# Create a new presentation

Use when the desired result is a new narrative/design from a topic, outline or source material. If preserving the appearance of supplied pages is central, use [Replicate](replicate.md). Use [Populate](populate-template.md) for repeated template fields.

Required modules: [CLI context](../modules/cli-context.md), [Typography/layout](../modules/typography-layout.md), [Verification/recovery](../modules/verification-recovery.md). Load [Charts/tables](../modules/charts-tables.md) only for data objects.

1. Establish audience, purpose, inputs, output location and approximate length from context. Ask only for a missing decision that matters. Separate sourced product facts from assumptions; retain references for claims and numbers.
2. Outline the story and decide slide dimensions, grid, palette, typography and content density once. If a template was supplied, inspect it; use the existing-file preservation workflow rather than inventing its brand.
3. Load the installed context once. Choose an absent/empty workspace. `new` starts with a Title Slide; for freeform work replace it with an actual Blank layout inside the first batch.
4. Adapt [create-pptx.json](../examples/create-pptx.json). The sample builds a native background, heading and semantic bullet list. It deliberately does not assume a platform-specific Chinese font; select a suitable family for the user's target environment before multilingual delivery.

```bash
deckuse new ./ws --format pptx --json
deckuse list layouts --workspace ./ws --json
deckuse apply --workspace ./ws --input ./ops.json --json
```

Copy/adapt the bundled JSON into the task's `ops.json`; do not edit installed skill resources. Add all pages before operations that refer to their final indexes. Put each coherent build in one transaction, not a loop of one-process-per-object writes. Preserve names and required semantics for future editing. A dry-run cannot prove native layout correctness.

5. For diagrams, quantitative charts and tables, load [Native drawing](../modules/native-drawing.md) and adapt its executable object recipes rather than defaulting to screenshots or many unrelated rectangles.
6. Check exact page count, expected title/text and native object inventory. Validate, export, batch-render and inspect every delivered page using [Quality review](../modules/quality-review.md). Check Chinese line endings and chart legend/value association even when diagnostics are empty. Fix diagnosed content/geometry in another bounded batch. Keep heuristic warnings distinct from visual defects.
7. Deliver the PPTX and report the actual verification states, selected font strategy and remaining native review. Do not use an entire-slide bitmap as an editable design substitute.
