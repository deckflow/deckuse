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

Create an `operations.json` file containing all changes for the slide or presentation:

```json
{
  "operations": [
    {
      "type": "addShape",
      "slide": 1,
      "shapeType": "text",
      "name": "HeaderTitle",
      "x": "5%",
      "y": "50px",
      "width": "90%",
      "height": "60px",
      "text": "Quarterly Financial Overview"
    },
    {
      "type": "setText",
      "target": "slide:1/shape:HeaderTitle",
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
}
```

Apply in one shot:

```bash
deckuse apply --workspace ./workspace --input operations.json --json
```

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

### A. Rich Text & Metric (KPI) Cards

When rendering a KPI block (e.g., small gray subtitle + large colored number):

```json
{
  "type": "setText",
  "target": "slide:2/shape:5",
  "blocks": [
    { "text": "Total Net Revenue", "fontSize": 11, "textColor": "6B7280" },
    { "text": "$1,280,000", "fontSize": 28, "bold": true, "textColor": "059669" },
    { "text": "+18.4% YoY Growth", "fontSize": 10, "textColor": "10B981" }
  ]
}
```

_Note_: Multiple lines with plain text can also use `\n` in `"text": "Line 1\nLine 2"`.

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

### C. Standard & Dual-Axis Combo Charts

```json
{
  "type": "addShape",
  "slide": 3,
  "shapeType": "chart",
  "chartType": "combo",
  "x": "5%",
  "y": "120px",
  "width": "90%",
  "height": "400px",
  "showDataLabels": true,
  "data": {
    "title": "Revenue vs Margin %",
    "categories": ["Q1", "Q2", "Q3", "Q4"],
    "series": [
      {
        "name": "Revenue ($M)",
        "values": [12, 19, 15, 25],
        "chart": "column",
        "axis": "primary",
        "color": "2563EB"
      },
      {
        "name": "Margin %",
        "values": [0.18, 0.22, 0.21, 0.28],
        "chart": "line",
        "axis": "secondary",
        "color": "10B981"
      }
    ]
  }
}
```

- Basic types: `"bar" | "column" | "line" | "pie"`.
- Combo requires series to designate `"chart": "column"|"bar"|"line"` and at least one line and one bar/column.

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
   - `ELEMENT_NOT_FOUND`: Check `deckuse list shapes --slide N` to see valid shape IDs.
   - `INVALID_COMMAND`: Check schema requirements (e.g. `--type image` requires `--file`, `--type table` requires `--rows`).
   - `UNSUPPORTED_CAPABILITY`: Community edition restricts master/layout/theme writes.

---

## 5. Agent Workflow Checklist

- [ ] Initialized workspace with `deckuse init <src> <ws> --json`?
- [ ] Retrieved actual shape IDs via `list` or `search` before writing?
- [ ] Used unit strings (`px`, `%`, `pt`) rather than computing large EMUs manually?
- [ ] Grouped multiple mutations into a single `apply` batch?
- [ ] Ran `deckuse validate --workspace <ws> --json` after applying changes?
- [ ] Rendered key slides via `deckuse render --page <N>` to inspect visual alignment?
- [ ] Exported final document via `deckuse export <dest> --workspace <ws> --json`?
