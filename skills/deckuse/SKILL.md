---
name: deckuse
description: Use when inspecting, creating, modifying, automating, or verifying PowerPoint (PPTX) or Word (DOCX) documents with the Deckuse CLI. Covers workspace management, semantic targeting, batch mutations with apply, layout alignment, rich text blocks, tables, charts, and visual rendering checks.
---

# Deckuse Agent Skill

**Requires CLI `deckuse >= 1.3.0` (edition=community).** Check with `deckuse --version`. If older, upgrade before following recipes below (`new` and recent apply/units features).

Deckuse is a local-first, schema-driven Office document automation engine for coding agents. It treats PPTX files as versioned workspaces, provides stable semantic addresses (`slide:N/shape:ID`), applies surgical atomic mutations, and tracks history via Git revisions.

Prefer **`deckuse schema --type addShape --json`** (or full `deckuse schema --json`) over guessing fields from memory.

---

## 1. Core Operating Principles for AI Agents

1. **Workspace-First Architecture**:
   Never edit `.pptx` in-place. Use `deckuse new ./ws --json` (bundled blank template) or `deckuse init input.pptx ./ws --json` (existing file). Mutations update `source/`, commit via Git, append `.deckuse/operations.jsonl`, and rebuild `./ws/package.pptx`.
2. **Batch Mutations via `apply`**:
   Do **NOT** run many individual write CLIs. Each write = one revision + recompress. Prefer one JSON batch:
   ```bash
   deckuse apply --workspace ./ws --input ops.json --json
   ```
   Geometry tweaks (`xfrmSet` / `setTransform`) belong in the **same** `apply` batch — do not loop `deckuse xfrm`.
3. **Derived Index & Stable Addressing**:
   - `slide:1/shape:2`, `slide:1/shape:Title 1`, `slide:1/placeholder:title`
   - `slide:1/shape:2/run:0` for single-run `setProperties` (intra-paragraph styling)
   - `slide:1/notes` is the **speaker-notes body** only (header / slide-number placeholders are ignored)
   - `slide:1/shape:3/cell:0:0` addresses a table cell; cell `setProperties` / `get` support `text`, `paragraph.align`, `fill`, `font.size`/`font.family`/`font.color`/`font.weight`/`font.italic`, `stroke`/`border` (`line.color`/`line.width` on get), and `padding.left|right|top|bottom` (pt)
   - **Same-batch forward refs**: after `addShape` with `"name": "HeaderTitle"`, later ops in the **same** `apply` may target `slide:N/shape:HeaderTitle`. Cross-apply dry-runs cannot see uncommitted shapes — that is expected.
4. **Intuitive Unit System**:
   `px` (96 DPI), `pt`, `cm`, `mm`, `in`, `%` (of slide). Bare numbers = EMU. Example: `"x": "5%"`, `"y": "120px"`.
5. **Structural Engine, Not Visual Brain**:
   Use `deckuse render --page N` for visual QA. Combo/advanced charts emit `COMBO_CHART_RENDER_LIMITED`; explicit series colors emit `CHART_SERIES_COLOR_UNVERIFIED`. Confirm via `ppt/charts/chart*.xml` or PowerPoint. Pages without those charts omit a generic fidelity warning.
6. **Community Edition Boundaries**:
   Writing `master:*` / `layout:*` / `theme` **part contents** → `UNSUPPORTED_CAPABILITY`.
   Rebinding a slide's layout (`setSlideLayout`) is allowed — it only changes the relationship.
7. **Monitor daemons**:
   `deckuse monitor status` (no `--workspace`) lists all running `monitor start` daemons (pid/port/workspace). Stop with `--workspace <path>` or `stop --all`. Foreground `deckuse monitor` is not tracked.

---

## 2. Standard Agent Interaction Loop

```text
[1. New or Init] ➔ [2. Inspect & Search] ➔ [3. Prepare & Apply Batch] ➔ [4. Validate & Render] ➔ [5. Export]
```

### Freeform layout (from-scratch / 1:1 recreate)

1. Start with `deckuse new ./workspace --json` (blank 16:9 title slide) unless you already have a master PPTX to `init`.
2. Estimate a grid (margins, columns) using `%` / `px` or `deckuse measure --text … --font-size N --json`.
3. Create shapes + styles in **one** `apply` (inline `fill`/`stroke`/`blocks`/`runs`).
4. `deckuse validate` then `deckuse render --page N`.
5. Adjust geometry with **another** `apply` containing multiple `xfrmSet` / `setTransform` ops (one revision).
6. Prefer `wrap: "none"` and generous widths to avoid mid-word wraps; use `anchor` for valign.

### Step 1–5 (commands)

```bash
deckuse new ./workspace --json
# or: deckuse init master.pptx ./workspace --json
deckuse status --workspace ./workspace --json
deckuse list shapes --slide 1 --workspace ./workspace --json
deckuse find "the revenue card" --workspace ./workspace --json
deckuse apply --workspace ./workspace --input ops.json --json
deckuse validate --workspace ./workspace --json
deckuse render --page 1 --workspace ./workspace --output ./slide-1.png --json
deckuse export ./output.pptx --workspace ./workspace --json
```

Default **`export` rebuilds from `source/`** (includes hand-edits). Use `--from-package` only to copy the existing snapshot. `status.packageStale` flags dirty `source/`.

`find` returns the same `matches` list as `search` (`target`, `uid`, `kind`, `name`, `text`). It needs `TYPESAFE_API_KEY` and sends names plus visible text to `api.typesafe.ai`. Literal `search` stays on this machine. An empty `matches` list means nothing fit — do not edit a guessed target. Jev is stronger in English than in Chinese.

### `setProperties` keys

Canonical: `fontSize`, `bold`, `textColor`, `fill`, `stroke`, `paragraph.align` (accepts `center`/`ctr`), `wrap` (`none`|`square`), `anchor`/`valign` (`t`|`ctr`|`b`), `cornerRadius` (0–1 on roundRect).

---

## 3. High-Value Operation Recipes

### A. KPI Cards (inline create + style) — requires >= 1.2.0

```json
[
  {
    "type": "addShape",
    "slide": 2,
    "shapeType": "rect",
    "name": "KpiRevenue",
    "x": "5%",
    "y": "120px",
    "width": "28%",
    "height": "100px",
    "fill": { "color": "F0FDF4" },
    "stroke": { "color": "BBF7D0", "width": 1 },
    "blocks": [
      { "text": "总营收", "fontSize": 12, "textColor": "065F46" },
      { "text": "598 百万元", "fontSize": 24, "bold": true, "textColor": "059669" }
    ]
  }
]
```

Intra-paragraph color (e.g. red first letter) — **`runs` is supported**:

```json
{
  "type": "addShape",
  "slide": 3,
  "shapeType": "text",
  "name": "BrandC",
  "x": "5%",
  "y": "80px",
  "width": "40%",
  "height": "60px",
  "wrap": "none",
  "blocks": [
    {
      "align": "left",
      "runs": [
        { "text": "C", "fontSize": 28, "bold": true, "textColor": "DC2626" },
        { "text": "ustomer", "fontSize": 28, "bold": true, "textColor": "111827" }
      ]
    }
  ]
}
```

### B. Switch slide layout (rebind)

Rebind an existing slide to another layout **without** editing layout parts (community-safe). Prefer `list layouts` for indexes / display names first.

```json
[
  { "type": "setSlideLayout", "slide": 1, "layout": "2" },
  { "type": "setSlideLayout", "slide": 1, "layout": "slide:3" },
  { "type": "setSlideLayout", "slide": 2, "layout": "Blank" }
]
```

CLI: `deckuse set slide-layout --slide 1 --layout 2` or `--layout slide:3`.

`layout` accepts: 1-based index, `layout:N`, `slide:N` (copy that slide's layout), display name (`Blank`), or basename (`slideLayout2`). Same refs work on `addSlide.layout`. This only updates the slide→slideLayout relationship; shapes are preserved. Writing `layout:*` / `master:*` **part contents** remains `UNSUPPORTED_CAPABILITY`.

### C. Financial table

`height: "auto"` is a **heuristic** (wrap + padding); still `render` and watch `TABLE_HEIGHT_MAY_CLIP`. If the frame was resized with `xfrmSet` only, follow with `setTableLayout` (`height: "auto"` or `redistribute: "content"|"equal"`) — do not keep bumping `xfrm --height`. `setTableLayout` is a first-class `apply` / `runCommand` type (not batch-only).

```json
{
  "type": "addShape",
  "slide": 1,
  "shapeType": "table",
  "name": "FinTable",
  "x": "5%",
  "y": "120px",
  "width": "90%",
  "height": "auto",
  "theme": "zebra",
  "alignColumns": ["left", "right", "right"],
  "rows": [
    ["指标", "Q3", "Q4"],
    ["营收", "120", "135"],
    ["全年合计", "480", "510"]
  ]
}
```

### D. Flow / loop (native presets — no Pillow)

Shape vocabulary: `line`/`connector`; `elbow` / `curved-connector`; `arrow` / `left-arrow` / …; `rounded-rect` + `cornerRadius`; **`chevron`**, **`pentagon`**, **`trapezoid`**, **`triangle`**, **`circular-arrow`**, **`curved-right-arrow`**, **`curved-left-arrow`**.

```json
[
  {
    "type": "addShape",
    "slide": 1,
    "shapeType": "chevron",
    "name": "StepCollect",
    "x": "5%",
    "y": "200px",
    "width": "28%",
    "height": "64px",
    "fill": { "color": "2563EB" },
    "blocks": [{ "text": "Collect", "fontSize": 16, "textColor": "FFFFFF", "align": "center" }]
  },
  {
    "type": "addShape",
    "slide": 1,
    "shapeType": "circular-arrow",
    "name": "Loop",
    "x": "40%",
    "y": "320px",
    "width": "120px",
    "height": "120px",
    "fill": { "color": "F59E0B" }
  }
]
```

### E. Charts / Align / replaceText

Prefer `column|bar|line|pie` for render. Series `color` is written into chart XML. Community `render` may emit `CHART_SERIES_COLOR_UNVERIFIED` — verify XML or PowerPoint.

### F. Capability fallback (last resort)

Only when no preset fits: `shapeType: "image"`. Do **not** default to Pillow/SVG for connectors or arrows.

---

## 4. Rollback and Error Handling

```bash
deckuse undo --workspace ./workspace --steps 1 --json
```

- Always use `--json` for agents. On `INVALID_COMMAND`, read **`error.message`** (includes first field path) and **`error.diagnostics[]`** (`path` + `message`).
- `TARGET_NOT_FOUND`: list shapes; for dry-run, ensure the name was added in the **same** apply batch.
- `find` / `UPSTREAM_ERROR`: set `TYPESAFE_API_KEY`. An empty `matches` list is not a target.
- `UNSUPPORTED_CAPABILITY`: community master/layout/theme gate.
- `COMBO_CHART_RENDER_LIMITED` / `CHART_SERIES_COLOR_UNVERIFIED` / `TABLE_HEIGHT_MAY_CLIP` / `TABLE_OVERLAPS_SHAPE`: warnings, not write failures.
- `NOTES_SLIDE_MISMATCH`: workspace cannot be written until `deckuse repair --workspace ./ws --json` (unambiguous notes back-pointers only).
- Schema discovery: `deckuse schema --type addShape --json`.

---

## 5. Agent Workflow Checklist

- [ ] CLI >= 1.2.0 (`deckuse --version`)?
- [ ] Workspace created (`new` or `init`)?
- [ ] Used unit strings / named shapes / single `apply` batch?
- [ ] Prefer `column`/`bar`/`line`/`pie` when using `render`?
- [ ] Checked `error.diagnostics` on failure (not only top-level message)?
- [ ] Validated + rendered key slides; chart colors verified in XML if needed?
- [ ] Table auto-height rendered; used `setTableLayout` after frame-only resize if needed?
- [ ] `status.data.valid` / `export.data.valid` true before delivery (`ok: true` on export is not validation)?

---

## 6. Recipe: safe iteration on an existing deck

1. Keep the original PPTX. Record its SHA-256 (or copy) before `init`.
2. `deckuse init input.pptx ./ws --json` then `deckuse status --workspace ./ws --json`. Read `data.valid` and `data.diagnostics`.
3. If `NOTES_SLIDE_MISMATCH` appears and diagnostics show a single owning slide, run `deckuse repair --workspace ./ws --json`. Shared or unowned notes parts return `AMBIGUOUS_REFERENCE` — do not guess.
4. Batch edits with `apply`. Prefer `duplicate` + local text over rewriting untouched slides.
5. `deckuse validate --workspace ./ws --json` after writes. `export` still writes the file when invalid: treat `data.valid` as the gate, not envelope `ok`.
6. Byte changes in unused parts after `init → export` (pretty-printed XML, `[Content_Types].xml`) are normalization, not content edits. Compare slide XML you intended to change; confirm in PowerPoint.

---

## 7. Recipe: visual QA

1. After table `insertRow` / `insertColumn`, read `TABLE_OVERLAPS_SHAPE.details.candidates` and run one `setTableLayout` from that list in the same or next `apply`. Check whether the overlap warning remains after layout.
2. `deckuse render --page N --json`. `COMBO_CHART_RENDER_LIMITED` means the PNG may be a placeholder; `CHART_SERIES_COLOR_UNVERIFIED` means legend/series fills may not match PowerPoint. Confirm `ppt/charts/*.xml` or open the exported PPTX.
3. Do not treat community `render` / `monitor` as the final visual sign-off.

---

## 8. Word (DOCX)

Same workspace loop as PPTX. Do **not** send slide geometry (`addShape`, `xfrmSet`, `alignElements`, `zMove`); those return `UNSUPPORTED_CAPABILITY`.

```bash
deckuse new ./workspace --format docx --json
# or: deckuse init report.docx ./workspace --json
deckuse list paragraphs --workspace ./workspace --json
deckuse apply --workspace ./workspace --input ops.json --json
deckuse validate --workspace ./workspace --json
deckuse export ./output.docx --workspace ./workspace --json
```

`new` without `--format` stays PPTX.

### Addresses

- `body/p:3` — 1-based body paragraph (tables are not paragraphs)
- `body/p:3/run:0` — 0-based run
- `para:1A2B3C4D` — `w14:paraId`
- `bookmark:Intro` — bookmark. `addParagraph.name` creates one for same-batch forward refs
- `body/table:1/row:2/cell:1/p:1`
- `style:Heading1` — read only. Apply it with `paragraph.style`; do not write `styles.xml`

### `replaceText`

Word often splits one sentence across `w:r` nodes (`w:proofErr`, direct formatting). `replaceText` concatenates visible `w:t` text **inside one paragraph**, then splices only the matched span and keeps neighboring `rPr`. It fails instead of rewriting tracked changes, fields, comments, content controls, or equations.

### Create

```json
[
  {
    "type": "addParagraph",
    "after": "body/p:1",
    "style": "Heading1",
    "name": "Intro",
    "blocks": [{ "text": "总营收", "fontSize": 16, "bold": true }]
  },
  { "type": "setText", "target": "bookmark:Intro", "value": "Updated" },
  {
    "type": "addTable",
    "name": "FinTable",
    "rows": [
      ["指标", "Q3"],
      ["营收", "120"]
    ]
  }
]
```

`deckuse render --page` does not paginate DOCX. `@deckflow/deck2html` converts PPTX only. Export and open the file in Word for layout checks.

Schema: `deckuse schema --type addParagraph --json`.
