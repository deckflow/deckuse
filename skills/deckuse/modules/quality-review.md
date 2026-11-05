# Review the actual presentation

Use after the first coherent visual build and again after content/layout changes. A successful apply and a clean diagnostics array do not establish good typography or a high-quality presentation.

## First visual pass

Render every delivered PPTX page and inspect the actual images at useful resolution, not only filenames or a very small contact sheet. Contact sheets help judge consistency; open individual text/data-heavy pages to judge detail.

- Message: each page has a clear takeaway; headings, numbers and annotations agree with supplied sources/data. Separate a demonstration product/dataset from factual claims.
- Hierarchy: headings, body and labels form a consistent type scale. On a 1280×720 slide, approximately 30–40 pt headings and 18–22 pt main body are useful starting points, not mandatory sizes. Smaller table/chart labels and footnotes need intentional roles and readable output.
- Chinese/mixed text: inspect manual and automatic breaks, punctuation, single-character last lines and awkward split words. A manual newline after a near-full line can create an extra orphan line. Rewrite at phrase boundaries or increase space; inspect again rather than globally shrinking type.
- Geometry: alignment, margins, consistent card spacing, full-bleed corners, diagram endpoints and z-order. Intentional decorative overflow is different from missing content.
- Data: confirm the chart is actually visible. In a real test two native charts were blank in HTML despite render ok=true; a synthetic one-chart control isolated disappearance to setting valueFormatCode="0". Empty chart areas cannot pass visual review. Preserve the output and investigate renderer/environment diagnostics without repeating document writes. Then check chart marks, category order, legend association, values, units and related KPIs. A renderer warning about series colors is not resolved just because the chart looks plausible.
- Tables: actual cell text, column balance, row height, wrapping and data emphasis. XML validity does not prove that cell contents fit.
- Native semantics: object type matches the requested editing behavior. Chart-native, Excel Edit Data, grouped card, attached connector and accessible reading order are separate properties.

## Iterate on a bounded finding

Freeze the first output and record a specific problem: page/target, observation and intended fix. Change only the relevant content/style/geometry, then inspect changed pages and any dependent data summaries. Preserve the initial failure and output; do not repeatedly rebuild an already successful deck.

For reconstruction, compare against the actual source page and list missing elements or approximate gradients/artwork. Native objects alone do not prove visual fidelity. A controlled known-coordinate example is not a blind image/PDF reconstruction benchmark.

## Delivery decision

Fix observed clipping, unintended overlap, unreadable text, materially wrong chart mapping and missing requested content before calling the requested visual scope complete. If the target environment cannot be checked or an engine limitation remains, state the specific pending/failing check. Report the dimensions of quality separately; do not turn “native objects exist” or an author's self-rating into a universal quality guarantee. A user-requested review draft may be delivered with clearly identified limitations.
