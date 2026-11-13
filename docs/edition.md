# DeckUse Community Edition

This repository is the **community** product line (`edition=community`). It is the **sole source of truth** for shared Deckuse source (`src/core`, `src/opc`, `src/pptx`, `src/workspace`, …), published as the single npm package `@deckflow/deckuse`.

## Boundaries (community)

Authorization rules come from the edition scope matrix (Master/Layout/Theme/Advanced Chart, etc.).

Community edition:

- **Allows** editing common slide objects: shapes, text boxes, connectors, groups, pictures, tables, and **basic** charts (`pie` / `line` / `bar`/`column` families, plus **limited combo** = one `barChart` + one `lineChart` with optional dual Y-axis).
- **Allows** listing and resolving masters, layouts, and themes; placeholder inheritance reads remain available.
- **Allows** rebinding a slide to another layout (`setSlideLayout` / `addSlide.layout`) — this updates the slide→slideLayout relationship only.
- **Rejects** writes to master slides, layout slides, and theme parts (`UNSUPPORTED_CAPABILITY`).
- **Rejects** edits to **advanced** charts (other non-basic families, ChartEx, unclassifiable charts, combos other than bar+line).
- Embeds the closed-source `deck2html` engine for PPTX and DOCX conversion. `deckuse render` captures the resulting HTML with Playwright; DOCX page numbers follow HTML pagination.

DOCX community writes cover body paragraphs, runs, tables, bookmarks, and page breaks, including applying a style id that already exists in the document. Writes to `word/styles.xml`, `word/numbering.xml` definitions, `word/theme/`, and `word/settings.xml` are rejected. Native comments and tracked changes use dedicated review commands. Ordinary writes preserve protected content such as fields, content controls, and equations.

`editionCapabilities` is **status metadata** only. Proprietary write authorization lives in commercial packages via `registerPptxEditionExtension`.

## Distribution boundary

The public package includes shared editing primitives and capability metadata. The extension hook is an integration boundary for separate builds. The public CI and release checks use `pnpm check:no-commercial-leak` to prevent proprietary licensing or overlay code from entering the community artifact.

## Observability

Runtime/`status` reports:

- `edition`: `community`
- `variant`: `community`
- `distribution-channel`: `oss`

## Community gaps (matrix allows, not yet implemented)

- Basic Formula structured edit
- Full object classification (SmartArt / OLE / Formula / Model3D / Ink detection beyond current indexer)

These are not commercial-only; they remain open for community delivery later.
