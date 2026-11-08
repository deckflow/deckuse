# Create a new presentation

Use when the desired result is a new narrative/design from a topic, outline or source material. If preserving the appearance of supplied pages is central, use [Replicate](replicate.md). Use [Populate](populate-template.md) for repeated template fields.

Required modules: [CLI context](../modules/cli-context.md), [Typography/layout](../modules/typography-layout.md), [Verification/recovery](../modules/verification-recovery.md). Load [Charts/tables](../modules/charts-tables.md) only for data objects.

1. Establish audience, purpose, inputs, output location and approximate length from context. Ask only for a missing decision that matters. Separate sourced product facts from assumptions; retain references for claims and numbers.
2. Outline the story and decide slide dimensions, grid, palette, typography and content density once. If a template was supplied, inspect it; use the existing-file preservation workflow rather than inventing its brand.
3. Run `deckuse agent-context --format pptx --scenario create --include-schema --json` once. When a host request selects Deckuse, use this installed workflow and its operation contract.
4. Copy or adapt the installed [two-slide starter](../examples/create-blank-pptx.json) to `ops.json`. Start in an absent or empty workspace and stop after any failed command.

```sh
set -e
deckuse new ./ws --blank --json
deckuse apply --workspace ./ws --input ./ops.json --request-id create-1 --expect-revision 1 --summary --json
deckuse validate --workspace ./ws --json
deckuse export ./presentation.pptx --workspace ./ws --json
```

The blank slide is named `Blank starter`. Give new slides unique names and reference them by name. Preview is optional for structural export. When visual review is available, run `render --preflight --probe-browser` and `render --all` after obtaining the first artifact.

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
