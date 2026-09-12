---
name: deckuse
description: Use when inspecting, creating, modifying, automating, or verifying PowerPoint (PPTX) presentations with the Deckuse CLI. Covers workspace management, semantic targeting, batch mutations with apply, layout alignment, rich text blocks, tables, charts, and visual rendering checks.
---

# Deckuse Agent Skill

Deckuse is a local-first, schema-driven Office document automation engine specifically designed for coding agents. It treats PPTX files as versioned workspaces, provides stable semantic addresses (`slide:N/shape:ID`), applies surgical atomic mutations, and automatically tracks history via Git revisions.

---

## 1. Core Operating Principles for AI Agents

1. **Workspace-First Architecture**:
   Never attempt to edit `.pptx` files in-place. Always initialize a workspace with `deckuse init input.pptx ./ws --json`. Every mutation updates the workspace `source/`, creates a Git commit, appends to `.deckuse/operations.jsonl`, and rebuilds `./ws/package.pptx`.
2. **Batch Mutations via `apply` (Crucial Performance Rule)**:
   Do **NOT** execute multiple individual `deckuse set` / `add` CLI commands sequentially if you have multiple changes. Each write command creates a Git revision and recompresses the archive. Instead, prepare a JSON payload of operations and run a single atomic batch:
   ```bash
   deckuse apply --workspace ./ws --input ops.json --json
   ```
3. **Derived Index & Stable Addressing**:
   Do not guess array indexes or raw XML nodes. Target elements by semantic paths:
   - `slide:1/shape:2` (by shape cNvPr ID)
   - `slide:1/shape:Title 1` (by shape name)
   - `slide:1/placeholder:title`, `slide:1/placeholder:body`, `slide:1/placeholder:subTitle`
   - `slide:1/notes` (speaker notes)
   - `slide:1/shape:2/paragraph:0` or `slide:1/shape:2/run:0`
   - Same-batch forward refs work: after `addShape` with `"name": "HeaderTitle"`, later ops in the same `apply` may target `slide:N/shape:HeaderTitle`.
4. **Intuitive Unit System**:
   Coordinates and sizes accept human-friendly unit strings: `px` (96 DPI, 1px = 9525 EMU), `pt`, `cm`, `mm`, `in`, and `%` (relative to slide size, default 16:9 is 12192000×6858000 EMU). Bare numbers default to raw EMU. Example: `"x": "5%"`, `"y": "120px"`, `"width": "90%"`.
5. **Structural Engine, Not Visual Brain**:
   Deckuse performs strict OOXML manipulations and guarantees file integrity. It cannot autonomously judge whether text is overlapping or aesthetically pleasing. Use `deckuse render --page N` to screenshot slides for agent multimodal visual verification.
6. **Community Edition Boundaries**:
   Writing to `master:*`, `layout:*`, or `theme` parts is protected and returns `UNSUPPORTED_CAPABILITY`. DOCX, XLSX, Keynote, and Numbers are currently reserved stubs (`FORMAT_NOT_IMPLEMENTED`).

---

## 2. Standard Agent Interaction Loop

Always follow the 5-phase loop:

```text
[1. Init] ➔ [2. Inspect & Search] ➔ [3. Prepare & Apply Batch] ➔ [4. Validate & Render] ➔ [5. Export]
```

### Step 1: Initialize Workspace

```bash
deckuse init master.pptx ./workspace --json
```

### Step 2: Query and Inspect

Find target elements and collect IDs before modifying:

```bash
# Check overall structure and slide count
deckuse status --workspace ./workspace --json
deckuse list slides --workspace ./workspace --json

# Search text or shapes
deckuse search text "Target Text" --workspace ./workspace --json
deckuse search shape --name "Card" --workspace ./workspace --json
deckuse list shapes --slide 1 --workspace ./workspace --json

# Deep inspect shape properties and geometry
deckuse get slide:1/shape:2 --resolve both --workspace ./workspace --json
```

### Step 3: Atomic Batch Mutation (`apply`)

Create an `ops.json` file as a **top-level array** of write commands (preferred):

```json
[
  {
    "type": "addShape",
    "slide": 1,
    "shapeType": "text",
    "name": "HeaderTitle",
    "x": "5%",
    "y": "50px",
    "width": "90%",
    "height": "60px",
    "blocks": [
      { "text": "Q3 Revenue Report", "fontSize": 24, "bold": true, "textColor": "1F2937" },
      { "text": "Confidential • Internal Only", "fontSize": 12, "textColor": "6B7280" }
    ]
  },
  {
    "type": "setProperties",
    "target": "slide:1/shape:2",
    "properties": {
      "fill": { "color": "F3F4F6", "transparency": 0 },
      "stroke": { "color": "E5E7EB", "width": 1 }
    }
  }
]
```

Also accepted:

- Single command object `{ "type": "setText", ... }`
- `{ "operations": [ ... ] }` when each item is a high-level write (`type: "addShape"` / `setText` / …) — treated as the same batch
- JSONL (one command object per line)
- Low-level transaction ops: items with `op` (or `{ "operations": [...] }` of those) → `applyTransaction`

Apply in one shot:

```bash
deckuse apply --workspace ./workspace --input ops.json --json
```

#### `setProperties` property keys (canonical)

Prefer camelCase / nested objects. Dotted keys (`font.size`, `fill.color`, …) are also accepted and normalized.

| Intent | Canonical form |
| --- | --- |
| Font size (pt) | `fontSize: number` |
| Bold / italic / underline | `bold` / `italic` / `underline`: boolean |
| Text color | `textColor: "RRGGBB"` |
| Font family | `fontFamily: string` |
| Shape fill | `fill: { "color": "RRGGBB", "transparency"?: number }` |
| Shape border | `stroke: { "color": "RRGGBB", "width": number }` |

Dotted equivalents (also OK): `font.size`, `font.color`, `font.weight: "bold"`, `fill.color`, `line.color`.

CLI `deckuse set --font.size …` uses the same dotted vocabulary.

### Step 4: Validate and Visual QA

```bash
# Verify OOXML structure and package relationships
deckuse validate --workspace ./workspace --json

# Render specific slide to PNG for visual inspection (requires Chrome/Chromium)
deckuse render --page 1 --workspace ./workspace --output ./slide-1.png --json

# (Optional) Run monitor daemon for user live browser preview
deckuse monitor start --workspace ./workspace --port 4173
```

### Step 5: Export Final Artifact

```bash
deckuse export ./output.pptx --workspace ./workspace --json
```

---

## 3. High-Value Operation Recipes

### A. KPI Cards (inline create + style)

Prefer creating styled cards in one `addShape` (fill / stroke / blocks). Palette for a 3-column row: green `F0FDF4`/`059669`, blue `EFF6FF`/`2563EB`, amber `FFFBEB`/`D97706` (optional 4th: rose `FFF1F2`/`E11D48`).

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
  },
  {
    "type": "addShape",
    "slide": 2,
    "shapeType": "rect",
    "name": "KpiCost",
    "x": "36%",
    "y": "120px",
    "width": "28%",
    "height": "100px",
    "fill": { "color": "EFF6FF" },
    "stroke": { "color": "BFDBFE", "width": 1 },
    "blocks": [
      { "text": "总成本", "fontSize": 12, "textColor": "1E40AF" },
      { "text": "312 百万元", "fontSize": 24, "bold": true, "textColor": "2563EB" }
    ]
  },
  {
    "type": "addShape",
    "slide": 2,
    "shapeType": "rect",
    "name": "KpiProfit",
    "x": "67%",
    "y": "120px",
    "width": "28%",
    "height": "100px",
    "fill": { "color": "FFFBEB" },
    "stroke": { "color": "FDE68A", "width": 1 },
    "blocks": [
      { "text": "毛利", "fontSize": 12, "textColor": "92400E" },
      { "text": "286 百万元", "fontSize": 24, "bold": true, "textColor": "D97706" }
    ]
  }
]
```

For existing shapes, use `setText` with `blocks` and/or `setProperties`.

_Note_: Multiple lines with plain text can also use `\n` in `"text": "Line 1\nLine 2"`. When both `text` and `blocks` are present on `addShape`, `blocks` wins.

### B. Auto-Sized Styled Tables

```json
{
  "type": "addShape",
  "slide": 2,
  "shapeType": "table",
  "name": "FinancialTable",
  "x": "5%",
  "y": "180px",
  "width": "90%",
  "height": "auto",
  "theme": "zebra",
  "alignColumns": ["left", "right", "right", "right"],
  "rows": [
    ["Metric", "2024 Actual", "2025 Plan", "Variance"],
    ["Gross Margin", "$450K", "$520K", "+15.5%"],
    ["Operating Cost", "$180K", "$210K", "+16.7%"],
    ["EBITDA", "$270K", "$310K", "+14.8%"]
  ]
}
```

- `height: "auto"` uses font heuristics (~11pt × 1.65 per row) to prevent row clipping.
- `theme: "minimal" | "zebra"`.
- `alignColumns`: array of `'left'` | `'center'` | `'right'` (or `'l'` | `'ctr'` | `'r'`).

### C. Charts (prefer basic types for `render`)

**Prefer** `"bar" | "column" | "line" | "pie"` for community `deckuse render` (these render fully).

```json
{
  "type": "addShape",
  "slide": 3,
  "shapeType": "chart",
  "chartType": "column",
  "x": "5%",
  "y": "240px",
  "width": "90%",
  "height": "360px",
  "showDataLabels": true,
  "data": {
    "title": "Monthly Revenue",
    "categories": ["Jan", "Feb", "Mar", "Apr"],
    "series": [
      { "name": "Revenue ($M)", "values": [12, 19, 15, 25], "color": "2563EB" }
    ]
  }
}
```

`chartType: "combo"` can be written into the PPTX (bar/column + line, optional secondary axis), but community `render` may show an Advanced Chart placeholder. Prefer basic charts when visual QA via `render` matters.

### D. Smart Multi-Element Alignment

To evenly distribute cards or badges horizontally without manual EMU calculations:

```bash
deckuse align --workspace ./ws --slide 1 --targets "slide:1/shape:10,slide:1/shape:11,slide:1/shape:12" --mode distribute-h --gap 20px --json
```

Available modes: `left`, `right`, `top`, `bottom`, `center-h`, `center-v`, `distribute-h`, `distribute-v`.

### E. Global Text Replacement (Find & Replace)

For project renames or year bumps:

```json
{
  "type": "replaceText",
  "find": "FY2025",
  "replace": "FY2026",
  "selector": "slide=2"
}
```

Leave `selector` blank to target the entire presentation.

---

## 4. Rollback and Conflict Handling

1. **Undo**:
   If an operation broke slide layout or failed validation:
   ```bash
   deckuse undo --workspace ./workspace --steps 1 --json
   ```
2. **Revision Guard**:
   Pass `--expect-revision <N>` or use `expectRevision` in JSON mutations when working across asynchronous or multi-step agent tool calls to guarantee atomic updates without stale-state collisions.
3. **Diagnostics & Errors**:
   - `TARGET_NOT_FOUND` / `ELEMENT_NOT_FOUND`: Check `deckuse list shapes --slide N` to see valid shape IDs.
   - `INVALID_COMMAND`: Check schema requirements (e.g. `--type image` requires `--file`, `--type table` requires `--rows`).
   - `UNSUPPORTED_CAPABILITY`: Community edition restricts master/layout/theme writes.
   - `COMBO_CHART_RENDER_LIMITED` (warning): combo charts may not fully render in community `render`.

---

## 5. Agent Workflow Checklist

- [ ] Initialized workspace with `deckuse init <src> <ws> --json`?
- [ ] Retrieved actual shape IDs via `list` or `search` before writing (or used named shapes in the same batch)?
- [ ] Used unit strings (`px`, `%`, `pt`) rather than computing large EMUs manually?
- [ ] Grouped multiple mutations into a single `apply` batch (top-level JSON array)?
- [ ] Preferred `column`/`bar`/`line`/`pie` over `combo` when using `render`?
- [ ] Ran `deckuse validate --workspace <ws> --json` after applying changes?
- [ ] Rendered key slides via `deckuse render --page <N>` to inspect visual alignment?
- [ ] Exported final document via `deckuse export <dest> --workspace <ws> --json`?
