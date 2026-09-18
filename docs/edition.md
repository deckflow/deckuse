# DeckUse Community Edition

This repository is the **community** product line (`edition=community`). It is the **sole source of truth** for shared packages (`core`, `opc`, `pptx`, `workspace`, …).

The commercial product lives in the private `deckuse-commercial` repository as a **thin overlay**: it replaces `@deckflow/deckuse-edition-config`, registers a `PptxEditionExtension`, and may add proprietary packages. It must not maintain a second copy of shared source.

## Capability classes

| Class | Meaning | Where code lives |
| --- | --- | --- |
| **Shared primitives** | OOXML helpers used by community slide / basic-chart edits (`setNodeText`, `applyChartProperties`, …) | Public `@deckflow/deckuse-pptx` |
| **Edition-gated writes** | Master / Layout / Theme / Advanced Chart writes are **hard-denied** in shared code regardless of `editionCapabilities` | Allowed only via a registered `PptxEditionExtension` from private commercial packages |
| **B — proprietary** | Editors that must not appear in this public tree (SmartArt, office2html plus, …) | Only `deckuse-commercial` private packages, injected through the same extension / hooks |

Runtime edition gates (`UNSUPPORTED_CAPABILITY`) are **not** a secrecy mechanism for shared primitives. Anything committed here is visible under AGPL. Commercial overlays own *authorization and product write paths* for gated targets; they must not rely on flipping `editionCapabilities` in a swapped config package.

## Boundaries (community)

Authorization rules come from the edition scope matrix (Master/Layout/Theme/Advanced Chart, etc.).

Community edition:

- **Allows** editing common slide objects: shapes, text boxes, connectors, groups, pictures, tables, and **basic** charts (`pie` / `line` / `bar`/`column` families, plus **limited combo** = one `barChart` + one `lineChart` with optional dual Y-axis).
- **Allows** listing and resolving masters, layouts, and themes; placeholder inheritance reads remain available.
- **Allows** rebinding a slide to another layout (`setSlideLayout` / `addSlide.layout`) — this updates the slide→slideLayout relationship only.
- **Rejects** writes to master slides, layout slides, and theme parts (`UNSUPPORTED_CAPABILITY`).
- **Rejects** edits to **advanced** charts (other non-basic families, ChartEx, unclassifiable charts, combos other than bar+line).
- Embeds the closed-source `office2html` engine (not `office2html plus`).

`editionCapabilities` is **status metadata** only. Proprietary write authorization lives in commercial packages via `registerPptxEditionExtension`.

## License / certificate verification

Runtime commercial license checks (issue, verify, activate, `--license` / `DECKUSE_LICENSE` / `deckuse.lic`, and any `licensing/` gate) **must live only** in the private `deckuse-commercial` repository. This community repo’s `@deckflow/deckuse-edition-config` is constants-only: it must not contain licensing source, stubs, or conditional activation logic. `pnpm check:no-commercial-leak` enforces that boundary.

## Observability

Runtime/`status` reports:

- `edition`: `community`
- `variant`: `community`
- `distribution-channel`: `oss`

## Community gaps (matrix allows, not yet implemented)

- Basic Formula structured edit
- Full object classification (SmartArt / OLE / Formula / Model3D / Ink detection beyond current indexer)

These are not commercial-only; they remain open for community delivery later.
