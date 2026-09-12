# Agent cookbook

Short contract for coding agents operating DeckUse workspaces. Prefer `apply` over many single CLI writes.

## Units

- Protocol bare numbers are **EMU** (English Metric Units).
- Strings may carry units: `px` (96 DPI, 1px = 9525 EMU), `pt`, `cm`, `mm`, `in`, `emu`, `%`.
- `%` is relative to slide `sldSz` (default 16:9 `12192000×6858000` when missing).
- Example: `"x": "5%"`, `"height": "150px"`, `"gap": "20px"`.

## Batch with `apply`

```bash
deckuse apply --workspace ./ws --input ops.json --json
```

Preferred input: a **top-level array** of write commands. Same-batch forward refs by shape `name` work after `addShape`.

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
    "blocks": [
      { "text": "全年总收入", "fontSize": 12, "textColor": "6B7280" },
      { "text": "598 百万元", "fontSize": 20, "textColor": "059669", "bold": true }
    ]
  },
  {
    "type": "setProperties",
    "target": "slide:1/shape:HelloCard",
    "properties": {
      "stroke": { "color": "E5E7EB", "width": 1 }
    }
  },
  {
    "type": "alignElements",
    "slide": 1,
    "targets": ["slide:1/shape:3", "slide:1/shape:4"],
    "mode": "distribute-h",
    "gap": "20px"
  }
]
```

Also accepted: `{ "operations": [ ... ] }` of high-level writes (same batch), a single command object, or JSONL. Items with `op` go to low-level `applyTransaction`.

Multiple operations in one `apply` / `batch` commit as **one atomic revision**.

### `setProperties` keys

Canonical: `fontSize`, `bold`, `textColor`, `fontFamily`, `fill: { color }`, `stroke: { color, width }`.  
Dotted keys (`font.size`, `fill.color`, `line.color`, …) are normalized the same as `deckuse set`.

## Text

- Real newlines in JSON `setText.text` → separate paragraphs.
- CLI `--value 'a\\nb'` unescapes to a newline unless `--text-raw`.
- `--text-file path` reads UTF-8 as-is.
- Rich KPI lines: use `blocks` on `setText` or inline on `addShape`. Avoid Markdown.

## Tables

- `"height": "auto"` (or omit height) sizes the frame from row count × ~11pt heuristic.
- `"theme": "minimal" | "zebra"`.
- `"alignColumns": ["l","r","r"]` for column paragraph alignment.

## Charts

- Prefer for `render`: `bar` | `column` | `line` | `pie`.
- Combo (limited write): `chartType: "combo"` with series `chart: "column"|"bar"|"line"` and optional `axis: "secondary"`. Community `render` may placeholder Advanced Chart.
- `showDataLabels: true` on create, or `setProperties` `{ "showDataLabels": true }`.
- Axis / value format: `{ "valueFormatCode": "0%" }` (cache only; embedded workbook is not synced).

## Align / distribute

```bash
deckuse align --slide 2 --targets "slide:2/shape:3,slide:2/shape:4" --mode distribute-h --gap 20px
```

Modes: `left|right|top|bottom|center-h|center-v|distribute-h|distribute-v`.

## Monitor daemon

```bash
deckuse monitor start --port 4173
deckuse monitor status --json
deckuse monitor stop
```

Foreground (legacy): `deckuse monitor --port 4173`.

## Loop

`init → list/get/search → apply → validate → export`  
Use `render` / `monitor` only as visual aids, not as automated QA.
