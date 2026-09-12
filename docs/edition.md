# DeckUse Community Edition

This repository is the **community** product line (`edition=community`). It is the **sole source of truth** for shared packages (`core`, `opc`, `pptx`, `workspace`, …).

The commercial product lives in the private `deckuse-commercial` repository as a **thin overlay**: it replaces `@deckflow/deckuse-edition-config` and may add proprietary packages. It must not maintain a second copy of shared source.

## Capability classes

| Class                | Meaning                                                                                                                    | Where code lives                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A — gated shared** | Implementation is already (or intentionally) in this public repo; community builds refuse writes via `editionCapabilities` | Public packages + `@deckflow/deckuse-edition-config`               |
| **B — proprietary**  | Must not appear in this public tree or in community npm tarballs                                                           | Only `deckuse-commercial` private packages, injected through hooks |

Runtime edition gates (`UNSUPPORTED_CAPABILITY`) are **not** a secrecy mechanism. Anything committed here is visible under AGPL.

## Boundaries (community / class A)

Authorization rules come from the edition scope matrix (Master/Layout/Theme/Advanced Chart, etc.).

Community edition:

- **Allows** editing common slide objects: shapes, text boxes, connectors, groups, pictures, tables, and **basic** charts (`pie` / `line` / `bar`/`column` families, plus **limited combo** = one `barChart` + one `lineChart` with optional dual Y-axis).
- **Allows** listing and resolving masters, layouts, and themes; placeholder inheritance reads remain available.
- **Rejects** writes to master slides, layout slides, and theme parts (`UNSUPPORTED_CAPABILITY`).
- **Rejects** edits to **advanced** charts (other non-basic families, ChartEx, unclassifiable charts, combos other than bar+line).
- Embeds the closed-source `office2html` engine (not `office2html plus`).

Commercial overlay sets `editionCapabilities.mastersEdit` / `layoutsEdit` / `chartBasicOnly` accordingly. Proprietary engines and class-B editors stay out of this repository.

## Observability

Runtime/`status` reports:

- `edition`: `community`
- `variant`: `community`
- `distribution-channel`: `oss`

## Community gaps (matrix allows, not yet implemented)

- Basic Formula structured edit
- Full object classification (SmartArt / OLE / Formula / Model3D / Ink detection beyond current indexer)

These are not commercial-only; they remain open for community delivery later.
