# ADR-0001: Keep OOXML canonical and indexes derived

- Status: Accepted
- Date: 2026-08-06

## Decision

Preserve OPC/OOXML package parts as canonical state. Build query and element indexes as derived state. Stage mutations transactionally and serialize only affected parts.

## Consequences

Unknown markup and producer extensions round-trip with high fidelity, and index corruption cannot corrupt source data. Adapters must implement invalidation, relationship integrity, conflict checks, and deterministic stable-reference resolution. Memory use is higher than a lossy normalized model.
