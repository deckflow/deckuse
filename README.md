<div align="center">

# Deckuse

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse is a local-first, schema-driven Office document automation engine for coding agents. It turns document editing into an explicit, reviewable workflow: open a versioned workspace, inspect and target its structure, apply JSON commands, validate the result, and export a new document.

The engine is built around format adapters. PPTX is the currently implemented format; DOCX, XLSX, Keynote, and Numbers adapters return `FORMAT_NOT_IMPLEMENTED` today, so agents fail clearly instead of silently producing unsafe edits.

## Why Deckuse

Deckuse lets an agent modify an existing presentation without recreating it from scratch. Its workflow is deliberately structural rather than visual:

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → commit → updated.pptx
```

It preserves untouched XML and unknown package parts where possible. It is not a rendering engine and cannot reliably judge whether a slide is visually attractive or whether a layout is visually correct.

## Where it creates value

Deckuse is designed for document changes that need to be precise, repeatable,
and auditable:

- **Recurring content updates** — refresh dates, metrics, names, pricing, and
  disclaimers without rebuilding a presentation.
- **Customer and market variants** — create controlled versions with explicit
  selectors and reviewable operations.
- **Content governance** — query sensitive or outdated content, inspect every
  match, and validate before export.
- **Agent-driven automation** — use structured JSON, revision checks, dry runs,
  atomic batches, and operation logs in larger workflows.

## Installation

Requirements: Node.js 18 or later.

```sh
npm install -g @deckflow/deckuse
```

This installs the `deckuse` CLI globally.

## CLI workflow

```sh
# Create a persistent workspace from a presentation.
deckuse init input.pptx ./workspace --json

# Inspect the indexed document and query target elements.
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json
deckuse query ./workspace 'hasText=true text~=[\u4e00-\u9fff]' --json

# Apply one JSON command, a JSON array, or JSONL.
deckuse apply ./workspace --input operations.jsonl --json

# Verify the package and export it.
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
# Use --force only when replacing an existing output file.
deckuse commit ./workspace -o output.pptx --force --json
```

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command. When invoked without a subcommand, the CLI instead accepts one complete JSON command on standard input.

Command results are written to standard output as JSON. Errors caused by invalid arguments or input are written to standard error. Exit status `0` means success, `1` means that a command failed, and `2` means CLI usage or parsing failure.

### Selectors

`query` accepts either a selector string or a structured selector in a command. Space-separated terms are combined with AND.

| Syntax                                 | Meaning                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `*` or `all`                           | Match every indexed element.                         |
| `kind=textbox`                         | Match an element kind by case-insensitive substring. |
| `text=Quarter`                         | Match text that contains the literal value.          |
| `text~=pattern`                        | Match text with a Unicode regular expression.        |
| `hasText=true`                         | Match elements that contain text.                    |
| `slide=256`, `id=256:10`, `name=Title` | Filter by slide ID, element ID, or name.             |

Use query results as the source of stable element references. A reference includes a document ID and an element ID or structural path; array positions are not stable identifiers.

## Common agent workflows

These examples use only the current PPTX capabilities. They describe workflows that an agent can compose from Deckuse primitives, rather than claiming that Deckuse independently performs reasoning, copywriting, or visual review.

### 1. Update an outdated year across a presentation

**Request:** “Change every `FY2025` reference to `FY2026`, and do not change anything else.”

Use `query` first to review the affected elements, then perform a literal `replaceText` and validate before exporting.

```sh
deckuse init master.pptx ./year-update --json
deckuse query ./year-update 'text=FY2025' --limit 1000 --json
cat > year-update.json <<'EOF'
{
  "type": "replaceText",
  "find": "FY2025",
  "replace": "FY2026"
}
EOF
deckuse apply ./year-update --input year-update.json --json
deckuse validate ./year-update --json
deckuse commit ./year-update -o master-fy2026.pptx --json
```

The review query limits the change to known occurrences; `replaceText` performs the approved bulk mutation while leaving unrelated objects intact.

### 2. Rename a company or product

**Request:** “Replace the old product name with the new product name everywhere.”

This is the same safe review-and-replace pattern. Search the exact old name first, then use `replaceText` with a literal value. For variations such as punctuation or spacing, use a regular-expression replacement only after checking the query output.

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

For a more constrained change, include a selector in the command, for example `"selector": "slide=256"`, so only one slide is eligible.

### 3. Extract a presentation outline for an agent

**Request:** “List the slide titles and summarize what this deck covers.”

Run `inspect` to retrieve the indexed presentation structure, then query text-bearing objects. The calling agent can group the returned objects by slide ID, identify title-like objects by their names, positions, or text, and generate a summary from the extracted text.

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse supplies the structured source data. The agent, not Deckuse, is responsible for deciding which text is a title and for writing the summary.

### 4. Run pre-delivery content QA

**Request:** “Find old customer names, dates, product names, URLs, and required disclaimer text before this deck is sent.”

Query for each known risk and inspect the returned references. Absence checks work the same way: query for the required text and flag an empty result. An agent can produce a QA report without modifying the presentation, or prepare narrowly targeted `setText` / `replaceText` commands for approved fixes.

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

This is content and structural QA, not visual QA. Deckuse does not render slides or determine whether text overlaps other content.

### 5. Change exactly one item on one slide

**Request:** “On slide 7, change the title to `Enterprise Strategy`; change nothing else.”

First query that slide and title text, then take the returned `ref` and send a `setText` command. The `ref` prevents an ambiguous global replacement.

```json
{
  "type": "setText",
  "ref": {
    "documentId": "./workspace",
    "elementId": "256:10"
  },
  "text": "Enterprise Strategy"
}
```

Element IDs are presentation-specific examples. Always use an ID returned by the current workspace rather than copying this value.

### 6. Standardize title typography

**Request:** “Make every approved title 28 pt and use the approved typeface.”

Use a query to identify title objects, have the agent review or filter the returned references, and apply `setProperties` once for each approved reference. `setProperties` targets one reference at a time; it does not accept a selector itself.

```json
{
  "type": "setProperties",
  "ref": {
    "documentId": "./workspace",
    "elementId": "256:8"
  },
  "properties": {
    "fontSize": 28,
    "fontFamily": "Approved Sans",
    "bold": true
  }
}
```

The same command can set `fill`, `stroke` (also `border`, `outline`, or `line`), `textColor`, `italic`, `underline`, `name`, and `hidden`. Unknown property keys fail with `INVALID_COMMAND`.

### 7. Adjust an object’s geometry precisely

**Request:** “Move every approved title slightly lower.”

Query and select the intended title references, inspect their current geometry, and issue one `setTransform` command per object with explicit coordinates. This is a structural geometry operation; do not market it as automatic layout correction without visual validation.

```json
{
  "type": "setTransform",
  "ref": {
    "documentId": "./workspace",
    "elementId": "256:8"
  },
  "transform": {
    "x": 914400,
    "y": 731520,
    "width": 8229600,
    "height": 685800
  }
}
```

Transform coordinates are OOXML EMUs. Preserve `x`, `width`, and `height` from the inspected object when only changing its vertical position.

### 8. Personalize an approved sales deck

**Request:** “Create a version for a prospective customer. Update the customer name and approved account-specific copy, but preserve the design.”

Create a separate workspace for each output from the approved master. Query the placeholders or existing customer text, apply only reviewed replacements, validate, and commit to a distinct file.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Apply reviewed replacements for this customer only.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
deckuse commit ./customer-a -o customer-a-deck.pptx --json
```

Separate workspaces prevent one customer’s edits from leaking into another output. Replace only the objects the approval process allows the agent to modify.

### 9. Produce regional or audience variants from one master

**Request:** “Generate regional and enterprise variants from the approved presentation.”

Initialize a fresh workspace from the same master for every variant. Each variant receives its own command file and output path. Use `batch` when a variant’s changes must be atomic: if one command fails, none of the batch changes are persisted.

```json
{
  "type": "batch",
  "atomic": true,
  "commands": [
    {
      "type": "replaceText",
      "find": "Default Message",
      "replace": "Regional Message"
    },
    {
      "type": "replaceText",
      "find": "Default Offer",
      "replace": "Enterprise Offer"
    }
  ]
}
```

This preserves a single approved source deck while making every variant reproducible from an explicit change set.

### 10. Let a coding agent operate an existing presentation

**Request:** “Inspect this deck, identify the requested edits, make them, and export a revised PPTX.”

Give the agent this loop: initialize a workspace, inspect or query before every targeted change, generate explicit JSON commands, apply them, validate the package, and commit a new output. Store the command file and command results alongside the task when auditability matters.

Deckuse gives the agent stable references, selectors, transactions, validation, and a deterministic export path. The agent provides task interpretation and decides which operations are appropriate.

## PPTX capabilities

- Persistent workspaces, revision-conflict detection, dry runs, atomic batches, and an operation log.
- `inspect`, `query`, and `getText`; stable references include slide ID, part URI, cNvPr ID, and ancestor path when available.
- `setText` and `replaceText`, including literal or regular-expression replacement in an optional selector scope.
- `setTransform` for explicit object position, size, rotation, and flip changes.
- `setProperties` for common shape and text properties.
- Add, duplicate, and remove slides; duplicated slides clone mutable notes and chart parts while layouts and media can be shared safely.
- Add shapes/text boxes, connectors, groups, pictures (from a file path or base64), and tables; duplicate or remove elements.
- `replacePicture` replaces a picture’s embedded media in place while retaining its element reference and layer order.
- Table-cell addressing by table ID, row, and column; speaker-note reading and text editing.
- Chart title, series-name, and cached-value edits. When an embedded workbook exists, Deckuse emits `EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED` rather than claiming that workbook data was updated.
- Common text and `srgbClr` color edits in master, layout, and theme parts.
- Preservation of unknown parts and untouched nodes. ZIP files are recompressed, so fidelity is defined by uncompressed data for untouched entries rather than ZIP byte identity.

### `setProperties` example

```json
{
  "type": "setProperties",
  "ref": { "documentId": "./workspace", "elementId": "256:8" },
  "properties": {
    "stroke": { "color": "0000FF", "width": 1.5 },
    "fill": "none",
    "textColor": "111111",
    "fontSize": 18,
    "fontFamily": "Approved Sans",
    "bold": true
  }
}
```

`stroke` and `fill` accept a hexadecimal color string. Use `none`, `false`, or `null` for no stroke or fill. `stroke.width` is in points and defaults to `1`.

The complete command schema is at `packages/core/schema/command.schema.json`. The TypeScript package entry points are `@deckflow/deckuse-core`, `@deckflow/deckuse-opc`, and `@deckflow/deckuse-pptx`.

## Limitations

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## Development checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
