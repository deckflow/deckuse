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
   - **Same-batch forward refs**: after `addShape` with `"name": "HeaderTitle"`, later ops in the **same** `apply` may target `slide:N/shape:HeaderTitle`. Cross-apply dry-runs cannot see uncommitted shapes — that is expected.
4. **Intuitive Unit System**:
   `px` (96 DPI), `pt`, `cm`, `mm`, `in`, `%` (of slide). Bare numbers = EMU. Example: `"x": "5%"`, `"y": "120px"`.
5. **Structural Engine, Not Visual Brain**:
   Use `deckuse render --page N` for visual QA. Community render may **not** show custom chart series colors; confirm via `ppt/charts/chart*.xml` or PowerPoint. Response includes `RENDER_FIDELITY` warnings.
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
deckuse apply --workspace ./workspace --input ops.json --json
deckuse validate --workspace ./workspace --json
deckuse render --page 1 --workspace ./workspace --output ./slide-1.png --json
deckuse export ./output.pptx --workspace ./workspace --json
```

Default **`export` rebuilds from `source/`** (includes hand-edits). Use `--from-package` only to copy the existing snapshot. `status.packageStale` flags dirty `source/`.

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

`height: "auto"` is a **heuristic** (wrap + padding); still `render` and watch `TABLE_HEIGHT_MAY_CLIP`. If the frame was resized with `xfrmSet` only, follow with `setTableLayout` (`height: "auto"` or `redistribute: "content"|"equal"`) — do not keep bumping `xfrm --height`.

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

Prefer `column|bar|line|pie` for render. Series `color` is written into chart XML. **Community `render` may still show theme defaults** — verify XML or PowerPoint.

### F. Capability fallback (last resort)

Only when no preset fits: `shapeType: "image"`. Do **not** default to Pillow/SVG for connectors or arrows.

---

## 4. Rollback and Error Handling

```bash
deckuse undo --workspace ./workspace --steps 1 --json
```

- Always use `--json` for agents. On `INVALID_COMMAND`, read **`error.message`** (includes first field path) and **`error.diagnostics[]`** (`path` + `message`).
- `TARGET_NOT_FOUND`: list shapes; for dry-run, ensure the name was added in the **same** apply batch.
- `UNSUPPORTED_CAPABILITY`: community master/layout/theme gate.
- `COMBO_CHART_RENDER_LIMITED` / `RENDER_FIDELITY` / `TABLE_HEIGHT_MAY_CLIP`: warnings, not write failures.
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
- [ ] Exported final PPTX (default rebuilds from `source/`)?

---

## 6. Word (DOCX)

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

`deckuse render --page` does not paginate DOCX. `@deckflow/office2html` converts PPTX only. Export and open the file in Word for layout checks.

Schema: `deckuse schema --type addParagraph --json`.

---

## 6. Word (DOCX)

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

`deckuse render --page` does not paginate DOCX. `@deckflow/office2html` converts PPTX only. Export and open the file in Word for layout checks.

Schema: `deckuse schema --type addParagraph --json`.
