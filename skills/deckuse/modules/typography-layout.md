# Typography, layout and editability

Read for new visual designs, changed geometry, multilingual text and visual replication.

## Units and fonts

Read actual slide dimensions from inspect/OOXML; do not assume every source is 16:9. Geometry strings accept px (96 DPI), pt, cm, mm, in and percentages; bare geometry numbers are EMU. Text font sizes are points. Convert pt → px using 96/72 when estimating pixel boxes. Include paragraph spacing and insets; line spacing and Office behavior need rendered verification.

Choose fonts available in the intended environment, including Chinese/CJK coverage; record unresolved fallback. There is no universally installed Chinese font. Inherited fonts may come from a theme/layout: explicit Latin font alone does not prove East Asian glyph selection. Set supported `fontFamily` fields intentionally and review mixed Chinese/English/numerals/punctuation after rendering. Do not silently install or bundle unlicensed fonts.

Use `measure` only as an estimate. `autofit: resize` writes `spAutoFit`; it is not a measurement of final text height. For dense Chinese or 2/3/4/6-item lists, increase available space, reduce content or adjust the type scale after inspecting output. Do not make everything tiny to silence an estimate. Preserve a coherent grid, contrast, margins and reading order.

Inspect Chinese phrase endings after rendering: a manual newline can leave one last character on its own line when the preceding phrase wraps automatically. Resolve it by shortening the phrase or changing the box/line break with the actual font. A clean overflow-diagnostics array does not detect or excuse this typographic defect.

## Full-bleed backgrounds

Use a `rect` covering x/y=0 and width/height=100% for an opaque full-page fill when no supported slide-background operation is used. `rounded-rect` leaves exposed corners; reserve it for cards unless that is intended. Add the background before foreground content. Inspect all four corners on covers and closing pages. Intentional decorative circles can extend past the slide; assess warnings in context.

## Cards, bullets and groups

Use native text boxes, images and tables where the user expects editing. The executable [create example](../examples/create-pptx.json) uses native bullet properties rather than prefixing each string with `•`; hierarchy uses `paragraph.level` where supported. Different levels within one text box require a supported paragraph-targeting contract; do not invent it.

An inventory kind `group` or an `addShape` enum value is not proof of an operation that groups existing siblings. In 1.7.0 the high-level `addShape group` creates an empty group; it does not automatically adopt separately added card elements. Preserve existing grouped cards when editing. If the installed contract has a verified grouping operation, use it and check children, transforms and selection behavior. Otherwise report the limitation, or retain a native template group, rather than creating an empty group and claiming the card moves as a unit. Do not hand-patch XML merely to bypass this boundary.

Grouping, semantic bullet levels and accessibility reading order are separate checks. Verify target Office selection/movement and text editing only when an actual Office session is available; HTML screenshots cannot prove those properties. Never flatten the full slide to an image and label it editable.
