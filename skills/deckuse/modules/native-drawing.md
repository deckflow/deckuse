# Use native PowerPoint drawing intentionally

Read for diagrams, data objects, editable reconstruction or explicit native-object requirements. Use [native-blueprints.json](../examples/native-blueprints.json) as executable syntax after `new`; copy it into the task and adapt content/fonts. It replaces the default Title slide with three Blank pages containing a workflow, a native chart and a native table. It is a capability recipe, not a finished design for every brief.

## Choose the object before writing coordinates

| Content                            | Prefer                                                    | Verify                                                                                                              |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Titles, paragraphs and lists       | Native text boxes and paragraph/bullet properties         | Exact text, line breaks, font coverage, overflow; actual native text edit if Office is available                    |
| Process nodes, badges and UI cards | Native rect/rounded-rect/ellipse or a supported preset    | Named editable shapes, z-order, geometry, relevant grouping limits                                                  |
| Flow lines                         | Native connector/line with supported stroke and arrowhead | `p:cxnSp`, arrow direction, endpoints; attachment is a separate check                                               |
| Quantitative charts                | Native `chart` with explicit categories/series/units      | Chart relationships, cached data, categories and values, chart-vs-workbook editability                              |
| Tabular information                | Native `table` with rows, column widths and typography    | Actual table XML/cells, cell contents, wrapping and row fit                                                         |
| Logos/photos/irreducible artwork   | Separate picture assets with appropriate crop             | Correct source, aspect ratio, no unrelated baked-in text; never a whole-slide screenshot replacing editable content |

Do not draw a statistical chart as arbitrary rectangles just to avoid learning the chart contract. If a chart requirement exceeds the supported surface, explain that limit and choose a user-appropriate alternative explicitly. Do not describe rasterized labels as editable text.

## Diagram details

Set node positions from a grid, use semantic names and check edge routing at presentation size. In 1.9, use `groupShapes` on distinct siblings and `ungroupShapes` to release them. Preserving z-order requires consecutive siblings. Check child IDs, transforms and visible geometry after moving or ungrouping. On older CLIs, preserve existing template groups.

Use `addShape.start/end` with `{target,site}` and `routing: "auto"` for attached connectors. Resolve supported sites using `get`; for standard rectangles sites 0–3 are top, left, bottom and right. Verify native attachments and geometry after moving nodes. For freeform shapes, use `shapeType: "path"` with `geometry.viewBox` and `geometry.paths` containing move/line/cubic/close commands. Use `fill.type: "linearGradient"` with ordered stops, an angle and optional stop transparency. For a new nonstandard canvas, pass paired dimensions to `new`, for example `--width 14in --height 8in`.

In 1.9.0, ordinary `apply` arrays reject `groupShapes`, `ungroupShapes`, `mergeTableCells` and `unmergeTableCells`. Use a top-level `{"type":"batch","atomic":true,"commands":[...]}` with each child carrying the installed protocol `version`, the actual `workspaceId`, and `transactionId` set to the current raw revision from status. Check the installed patch before using the short array form. Use a fresh revision for each batch.

## Chart and table details

Load [Charts/tables](charts-tables.md). Compare the displayed KPI with the actual series, units, period and calculation; when changing data, update dependent headlines and annotations in the same batch. Use real table cells, not many unrelated text boxes, when tabular editing is expected. Retain readable type, column alignment and sufficiently tall rows.

Explicit series colors in OOXML do not prove the HTML preview legend uses those colors. Verify both bar/line marks and legend association, not only raw `srgbClr`. Keep `CHART_SERIES_COLOR_UNVERIFIED` unresolved until checked in the required target. Do not edit chart caches to bypass a workbook-verification refusal.

## Native-object proof has levels

1. Structural: count `p:sp`, `p:cxnSp`, chart references and `a:tbl`, inspect text and relationships, exclude full-slide rasterization.
2. Rendered: inspect actual output pages for text, geometry, colors and data mapping.
3. Native: when an authorized PowerPoint session is available, open an isolated copy, verify chart/table/shape recognition, make and save a small text/geometry/cell edit, then reopen that copy.

Only mark a level passed after its check. AppleEvent timeouts, zero reported open presentations or unavailable native-control permissions leave native opening/editing unverified. A valid PPTX with native XML is strong structural evidence, not proof that PowerPoint opened or edited it successfully. Do not change system permissions or repeatedly probe an unresponsive application to manufacture a pass.
