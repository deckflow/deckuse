# Agent cookbook

**Requires Deckuse CLI >= 1.2.0.** Short contract for coding agents. Prefer `apply` over many single CLI writes. Discover fields with `deckuse schema --json`.

## Units

- Protocol bare numbers are **EMU**.
- Strings may carry units: `px` (96 DPI, 1px = 9525 EMU), `pt`, `cm`, `mm`, `in`, `emu`, `%`.
- `%` is relative to slide `sldSz` (default 16:9 `12192000×6858000` when missing).
- Example: `"x": "5%"`, `"height": "150px"`, `"gap": "20px"`.

## Batch with `apply`

```bash
deckuse apply --workspace ./ws --input ops.json --json
```

Preferred input: a **top-level array** of write commands. Same-batch forward refs by shape `name` work after `addShape` (including `--dry-run`). Cross-batch dry-run cannot see shapes from a previous dry-run — expected.

```json
[
  {
    "type": "addShape",
    "slide": 1,
    "shapeType": "rect",
    "name": "HelloCard",
    "x": "5%",
    "y": "120px",
    "width": "90%",
    "height": "150px",
    "fill": { "color": "F3F4F6" },
    "wrap": "none",
    "anchor": "ctr",
    "blocks": [
      { "text": "全年总收入", "fontSize": 12, "textColor": "6B7280" },
      {
        "runs": [
          { "text": "598", "fontSize": 20, "textColor": "059669", "bold": true },
          { "text": " 百万元", "fontSize": 14, "textColor": "6B7280" }
        ]
      }
    ]
  },
  {
    "type": "setProperties",
    "target": "slide:1/shape:HelloCard",
    "properties": {
      "stroke": { "color": "E5E7EB", "width": 1 },
      "paragraph.align": "center"
    }
  }
]
```

Also accepted: `{ "operations": [ ... ] }`, single command, or JSONL. Geometry tweaks: put multiple `xfrmSet` / `setTransform` in one `apply` (one revision).

On `INVALID_COMMAND`, read `error.message` (includes field path) and `error.diagnostics`.

### `setProperties` keys

Canonical: `fontSize`, `bold`, `textColor`, `fontFamily`, `fill`, `stroke`, `paragraph.align` (`center`→`ctr`), `wrap`, `anchor`/`valign`, `cornerRadius`.  
Dotted keys (`font.size`, `fill.color`, …) are normalized the same as `deckuse set`.

## Text

- `blocks` = one paragraph per entry; optional `runs[]` for intra-paragraph styling (e.g. red first letter).
- `\n` inside `blocks`/`runs` text becomes additional paragraphs (same as `setText`).
- `deckuse measure --text "…" --font-size 24 --json` for heuristic box sizing.
- Prefer `wrap: "none"` for short labels to avoid mid-word wraps.

## Shapes

- `line` / `connector` = straight `cxnSp`; `elbow` / `curved-connector`; `arrow` / `left-arrow` / …
- `rounded-rect` + `cornerRadius` (0–1).
- Flow / infographic: `chevron`, `pentagon`, `trapezoid`, `triangle`, `rt-triangle`, `circular-arrow`, `curved-right-arrow`, `curved-left-arrow`.

### Flow strip (chevrons)

```json
[
  {
    "type": "addShape",
    "slide": 1,
    "shapeType": "chevron",
    "name": "Step1",
    "x": "5%",
    "y": "200px",
    "width": "28%",
    "height": "64px",
    "fill": { "color": "2563EB" },
    "blocks": [{ "text": "Collect", "fontSize": 16, "textColor": "FFFFFF", "align": "center" }]
  }
]
```

### Closed loop

Prefer `circular-arrow` / `curved-*-arrow` over raster connectors. Last resort only: `shapeType: "image"` for artwork that cannot be a preset — do not default to Pillow/SVG for arrows.

## Tables

- `height: "auto"` uses wrap + padding heuristics; complex cells may still clip — always `render`, watch `TABLE_HEIGHT_MAY_CLIP`.
- After `xfrmSet` changes only the frame: use `setTableLayout` with `height: "auto"` or `redistribute: "content"|"equal"` to reflow row heights (do not loop `xfrm --height`).

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

## Charts / Align / Monitor / Export

Chart series colors write to XML; **community `render` may not show them** — check `ppt/charts/*.xml`. Use `deckuse render --scale 2` when needed. Monitor: `--port 0` for ephemeral.

`export` rebuilds from `source/` by default (`--from-package` copies the snapshot). `status.packageStale` is true after hand-edits to `source/` until repack/export.

## Loop

`init → list/get/search → apply → validate → render → export`
