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
