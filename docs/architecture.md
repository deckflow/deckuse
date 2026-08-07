# Deckuse architecture

Deckuse is a schema-first document automation monorepo. `@deckflow/deckuse-core` owns the versioned wire contract, validation, results, diagnostics, adapter registry, and dispatch. Format packages implement `FormatAdapter`; the CLI is only a JSON-in/JSON-out transport and does not define a second contract.

## Canonical model: OOXML plus derived indexes

For OPC formats, the canonical state is the original package parts, relationships, content types, and unknown extension data—not a lossy normalized scene graph. Query indexes and convenient element views are derived, disposable, and rebuilt or incrementally invalidated after mutations. This preserves producer-specific XML, unsupported elements, ordering, and extension lists wherever a command does not intentionally change them.

## Transactions

Mutations require a transaction ID. Adapters stage changes in an isolated workspace revision; `batch` is atomic by default, and `commit` validates, checks the base revision for conflicts, writes to a temporary destination, and atomically replaces the target. Failed validation or writes leave the source and committed revision unchanged. Implementations should support cancellation and clean temporary resources.

## Fidelity

Adapters use surgical XML edits and retain untouched byte streams when possible. Serialization may normalize only modified parts. Full validation reports diagnostics without silently repairing content. Unsupported constructs remain round-trippable; a command targeting one must fail explicitly rather than corrupt it.

## Stable references

`ElementRef` uses a document ID plus a format-stable element ID when available, with a structural path fallback. A revision can pin optimistic reads. Derived array positions are not stable IDs. Missing and multiply resolved references return `ELEMENT_NOT_FOUND` and `AMBIGUOUS_REFERENCE`; adapters maintain aliases when duplication or producer-generated IDs require reconciliation.

## Versioning

The command envelope has an explicit protocol version. Additive compatible changes remain within a protocol line; changed semantics or removed fields require a new version and parallel schema. Package versions follow SemVer through Changesets. Adapter and workspace manifest versions are persisted so migrations are explicit. JSON Schema is generated from the same Zod schema used at runtime.

See [ADR-0001](adr/0001-ooxml-derived-indexes.md) and [ADR-0002](adr/0002-versioned-command-protocol.md).
