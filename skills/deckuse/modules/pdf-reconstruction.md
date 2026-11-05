# Complex PDF references

Load for dense, mixed-size or font-fragmented PDF reconstruction. Use available host PDF tools for extraction and visual inspection; Deckuse is the Office writer, not a PDF parser.

Inspect every selected page's effective dimensions, crop box and rotation. Do not infer all page sizes from page 1: a real report tested here ranged from 960×540 to 960×809 pt. PPTX has one canvas size for the whole deck. Choose a common canvas and record a per-page uniform contain transform with offsets, or explicitly reflow content. Never stretch axes independently to hide a ratio mismatch. Request custom dimensions only if the installed contract supports them; do not invent a new flag.

Inspect extraction granularity before creating objects. Type3 PDFs may expose hundreds of single-character spans for a few logical lines. Merge spans by baseline, reading order and compatible style; preserve intentional style changes as runs. One textbox per glyph makes editing and layout fragile. Verify merged lines against the page image, especially numbers, punctuation and multi-column order. Extracted glyph/font names are not proof that a usable Office font is installed.

Map text, boxes, table cells, icons and charts separately. Recover simple vectors as native shapes; use isolated, tightly cropped assets for irreducible icons/artwork, preserving transparency. A screenshot of a whole page is not an editable reconstruction. Native shapes can still be visually approximate: disclose substituted curves, gradients, fonts, logos and stamps. Do not turn a path bounding box into a rectangle and call it an exact path reconstruction.

Reconstruct a raster data graphic as a native chart/table only after verifying its labels, values and relationships. A legible categorical matrix can become a native table; an unreadable curve does not justify invented series data. Keep a source-page-to-slide map, extracted facts and uncertain readings. When using a report as material for a new narrative, preserve survey/publication dates and distinguish source findings from the author's interpretation and current facts.

Compare actual source/output pages at corresponding scale. Check long pages and the densest table individually; a contact sheet alone cannot establish legibility. Record content fidelity, appearance, editability and native Office verification separately. Contain scaling preserves geometry but can make text too small for a presentation: choose reflow when readability is the intended outcome.
