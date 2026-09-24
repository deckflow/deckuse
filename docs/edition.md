# DeckUse Community Edition

This repository is the **community** product line (`edition=community`). It is the **sole source of truth** for shared Deckuse source (`src/core`, `src/opc`, `src/pptx`, `src/workspace`, …), published as the single npm package `@deckflow/deckuse`.

The commercial product lives in the private `deckuse-commercial` repository as a **thin overlay**: it registers a `PptxEditionExtension`, supplies its own edition metadata / licensing, and may add proprietary packages. It must not maintain a second copy of shared source, and must not rewrite community `src/edition-config` in this tree.

## Capability classes

| Class                    | Meaning                                                                                                                | Where code lives                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Shared primitives**    | OOXML helpers used by community slide / basic-chart edits (`setNodeText`, `applyChartProperties`, …)                   | Public `src/pptx` in `@deckflow/deckuse`                                                |
| **Edition-gated writes** | Master / Layout / Theme / Advanced Chart writes are **hard-denied** in shared code regardless of `editionCapabilities` | Allowed only via a registered `PptxEditionExtension` from private commercial packages   |
| **B — proprietary**      | Editors that must not appear in this public tree (SmartArt, office2html plus, …)                                       | Only `deckuse-commercial` private packages, injected through the same extension / hooks |

Runtime edition gates (`UNSUPPORTED_CAPABILITY`) are **not** a secrecy mechanism for shared primitives. Anything committed here is visible under AGPL. Commercial overlays own _authorization and product write paths_ for gated targets; they must not rely on flipping `editionCapabilities` in `src/edition-config`.

## Boundaries (community)

Authorization rules come from the edition scope matrix (Master/Layout/Theme/Advanced Chart, etc.).

Community edition:

- **Allows** editing common slide objects: shapes, text boxes, connectors, groups, pictures, tables, and **basic** charts (`pie` / `line` / `bar`/`column` families, plus **limited combo** = one `barChart` + one `lineChart` with optional dual Y-axis).
- **Allows** listing and resolving masters, layouts, and themes; placeholder inheritance reads remain available.
- **Allows** rebinding a slide to another layout (`setSlideLayout` / `addSlide.layout`) — this updates the slide→slideLayout relationship only.
- **Rejects** writes to master slides, layout slides, and theme parts (`UNSUPPORTED_CAPABILITY`).
- **Rejects** edits to **advanced** charts (other non-basic families, ChartEx, unclassifiable charts, combos other than bar+line).
- Embeds the closed-source `office2html` engine (not `office2html plus`). That engine converts PPTX only, so `deckuse render --page` does not paginate DOCX.

DOCX community writes cover body paragraphs, runs, tables, bookmarks, and page breaks, including applying a style id that already exists in the document. Writes to `word/styles.xml`, `word/numbering.xml` definitions, `word/theme/`, and `word/settings.xml` are rejected. Tracked changes, fields, comments, content controls, and equations stay untouched; a command that would have to rewrite them fails.

`editionCapabilities` is **status metadata** only. Proprietary write authorization lives in commercial packages via `registerPptxEditionExtension`.

## License / certificate verification

Runtime commercial license checks (issue, verify, activate, `--license` / `DECKUSE_LICENSE` / `deckuse.lic`, and any `licensing/` gate) **must live only** in the private `deckuse-commercial` repository. This community repo’s `src/edition-config` is constants-only: it must not contain licensing source, stubs, or conditional activation logic. `pnpm check:no-commercial-leak` enforces that boundary.

### Commercial overlay migration note

Previously, commercial builds swapped the separate npm package `@deckflow/deckuse-edition-config`. That package no longer exists: edition constants live in `src/edition-config` inside `@deckflow/deckuse`. Commercial overlays should:

1. Keep shared source synced from this community repo (do not fork `src/pptx` / `src/core` / …).
2. Register a `PptxEditionExtension` (and any proprietary adapters) from commercial-only packages.
3. Supply commercial edition metadata / licensing from commercial entrypoints — never by patching community `src/edition-config` for publish of this AGPL package.

## Observability

Runtime/`status` reports:

- `edition`: `community`
- `variant`: `community`
- `distribution-channel`: `oss`

## Community gaps (matrix allows, not yet implemented)

- Basic Formula structured edit
- Full object classification (SmartArt / OLE / Formula / Model3D / Ink detection beyond current indexer)

These are not commercial-only; they remain open for community delivery later.
