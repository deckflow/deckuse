# Create a presentation

Plan audience, narrative, page count, and evidence before creating shapes. Choose an existing template when available. Enumerate layouts before selecting one. Define a consistent type scale, margins, palette, and content density. Batch each coherent page change, validate, render, inspect charts and text, and iterate before delivery.

## Atomic blank-deck recipe

Use a new, absent or empty destination. `new` and `init` reject nonempty
folders; keep an existing workspace and continue editing it rather than deleting it.
After `new`, this single apply batch replaces the initial title slide and fills a
new blank page:

```json
[
  { "type": "addSlide", "layout": "Blank", "name": "Introduction" },
  { "type": "remove", "target": "slide:1" },
  {
    "type": "addShape",
    "slide": 1,
    "shapeType": "text",
    "name": "Title",
    "x": "5%",
    "y": "5%",
    "width": "90%",
    "height": "80px",
    "text": "Introduction",
    "autofit": "resize"
  },
  { "type": "setText", "target": "slide:1/shape:Title", "value": "Updated introduction" }
]
```

Discover command types with `schema --list --json`, then inspect
`schema --type addSlide --json` or `schema --type addShape --json`.
`autofit: resize` writes an Office auto-fit instruction; it does not prove the
final text height or absence of clipping. Render and inspect every delivered page.

Capture stdout, stderr and exit status separately. Do not pipe `2>&1` into a JSON
parser. A timeout or JSON parsing failure does not establish that a mutation
failed: inspect `status`, `history` and `list slides` before retrying.

For older installed CLIs, inspect help before using new discovery or batch-render
options. If `--list`/`--pages`/`--all` are absent, use targeted `schema --type` and
single-page render calls. Always choose an absent or empty destination, including
on older versions that do not enforce this protection.

Input: topic/outline/material; output: new PPTX and verification report. Use supplied content before asking for missing facts; read [operations](operations.md) only for needed objects. Read [verification-recovery](verification-recovery.md) before delivery. On failed apply reconcile history before retrying; correct schema/target errors without recreating successful pages. Accept only when planned content and page inventory match, structure validates and all delivered pages have recorded visual review or explicit limitations.

## Multilingual full-bleed cards and native lists

Use the packaged [multilingual-cards.json](../assets/multilingual-cards.json) on a
new workspace (the default template is 1280 × 720 px). It demonstrates 2/3/4/6
items, Chinese/English/digits/punctuation and editable group children.

```bash
deckuse new ./cards-workspace --json
deckuse apply --workspace ./cards-workspace --input /path/to/installed/skills/deckuse/assets/multilingual-cards.json --json
deckuse validate --workspace ./cards-workspace --json
deckuse render --all --workspace ./cards-workspace --output-dir ./cards-preview --json
deckuse export ./cards.pptx --workspace ./cards-workspace --json
```

The JSON uses generic sans-serif intentionally: it is runnable across environments
but does not claim a universal CJK font or verified glyph coverage. Before client
delivery inspect available fonts on the render host and target Office host; replace
fontFamily in the recipe with a confirmed family or retain the user's template
inheritance deliberately. Record fallback risks and inspect Chinese glyphs after
rendering. Never silently install fonts or treat installed-family presence as proof
of all glyph coverage. Theme/inherited fonts require the same review.

All geometry is explicit px; fontSize is pt, so 16 pt ≈ 21.33 px at 96 DPI. Estimate
height from wrapped line count × fontSize × 96/72 × lineSpacing, plus paragraph
spaceBefore/spaceAfter converted from pt and top/bottom insets. Width and fallback
font metrics change wrap count: this is an estimate, as is measure. Inspect every
2/3/4/6-item result; if it clips, widen or raise the box, reduce density/split the
page, then adjust spacing/type size within the design and re-render. Office
autofit=resize is an instruction, not proof of measured fit.

FullBleed is a full-page rect behind content. Rounded cards are decorative shapes;
a rounded rectangle used as a page background can expose the four corners. Check
all four corners on cover/last page and after aspect-ratio changes; do not
automatically change intentionally rounded designs.

Each Card group contains background, heading and body with local coordinates.
Use group transforms for whole-card movement; confirm children remain together
and text stays editable after export. The recipe uses native bullet=true and
paragraph.level=0, not a literal • prefix. Literal bullets are valid artwork/text
but do not establish list semantics. Higher levels need explicit hierarchy and
review; grouping, reading order and accessibility are separate checks.

Acceptance: validate structure, inspect group children and paragraph buChar/lvl,
review text completeness, overflow, corner coverage and layout in HTML/Chrome.
Native PowerPoint open, group drag/edit, list editing and accessibility remain
unverified unless actually checked there. Do not rasterize the slide to hide
font/semantic failures.
