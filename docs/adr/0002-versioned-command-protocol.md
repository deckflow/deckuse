# ADR-0002: Use one versioned schema-first command protocol

- Status: Accepted
- Date: 2026-08-06

## Decision

All transports and TypeScript helpers use the core discriminated command union and unified result model. Runtime validation and exported JSON Schema derive from Zod. Breaking wire changes introduce a new protocol version rather than silently changing behavior.

## Consequences

CLI, services, and embedded callers have consistent behavior and diagnostics. Compatibility can be tested independently of adapters. Supporting multiple major protocol lines may require explicit translators and a longer maintenance window.
