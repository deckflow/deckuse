# DeckUse Community Edition

This repository is the **community** product line (`edition=community`).

## Boundaries

Authorization rules come from the edition scope matrix (Master/Layout/Theme/Advanced Chart, etc.).

Community edition:

- **Allows** editing common slide objects: shapes, text boxes, connectors, groups, pictures, tables, and **basic** charts (`pie` / `line` / `bar`/`column` families, plus **limited combo** = one `barChart` + one `lineChart` with optional dual Y-axis).
- **Allows** listing and resolving masters, layouts, and themes; placeholder inheritance reads remain available.
- **Rejects** writes to master slides, layout slides, and theme parts (`UNSUPPORTED_CAPABILITY`).
- **Rejects** edits to **advanced** charts (other non-basic families, ChartEx, unclassifiable charts, combos other than bar+line).
- Embeds the closed-source `office2html` engine (not `office2html plus`).

Commercial edition (separate repository: `deckuse-commercial`) keeps Master/Layout editing that already exists in the shared codebase and documents remaining commercial gaps separately.

## Observability

Runtime/`status` reports:

- `edition`: `community`
- `variant`: `community`
- `distribution-channel`: `oss`

## Community gaps (matrix allows, not yet implemented)

- Basic Formula structured edit
- Full object classification (SmartArt / OLE / Formula / Model3D / Ink detection beyond current indexer)

These are not commercial-only; they remain open for community delivery later.
