# Create DOCX

Required modules: [CLI context](../modules/cli-context.md), [Verification/recovery](../modules/verification-recovery.md). This is document structure and flow, not slide geometry.

Plan audience, factual sources, heading hierarchy, page expectations and tables. Create a fresh DOCX workspace and inspect available styles before choosing a style ID.

```bash
deckuse new ./ws --format docx --json
deckuse list styles --workspace ./ws --json
deckuse list paragraphs --workspace ./ws --json
deckuse apply --workspace ./ws --input ./doc-ops.json --json
deckuse validate --workspace ./ws --json
deckuse export ./output.docx --workspace ./ws --json
```

Adapt [create-docx.json](../examples/create-docx.json). Resolve paragraph/bookmark targets from the current document; `addParagraph`, `addTable` and `insertBreak` have different contracts from `addShape`. Use semantic styles and native tables; do not send slide x/y geometry to Word. Community style definition edits, fields and protected structures have explicit limits.

Check text order, heading hierarchy, tables and requested source facts. DOCX export/structure verification does not prove page layout. Use available Word/native tools for page count, table splits, fonts and selected/all page review as required. In 1.8.0 [DOCX HTML preview](preview-doc.md) can support approximate page review; it does not replace native Word pagination. Record unavailable native review and do not switch backends silently.
