<div align="center">

# Deckuse

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse is a local-first, schema-driven Office document automation engine for coding agents. It opens a document into a versioned workspace, lets an agent inspect and target its structure with semantic addresses (`slide:1/shape:2`), applies explicit mutations, validates the result, and exports a new document.

This repository is the **community edition** (`edition=community`). See [docs/edition.md](docs/edition.md). The commercial edition lives in a separate repository (`deckuse-commercial`).

PPTX is the currently implemented format (**protocol 2.0 / Phase 1a**). DOCX, XLSX, Keynote, and Numbers adapters deliberately return `FORMAT_NOT_IMPLEMENTED`; they are not supported editing targets yet.

## Why Deckuse

Deckuse lets an agent modify an existing presentation without recreating it from scratch. Its workflow is deliberately structural rather than visual:

```text
existing.pptx → init → list / get → set / add → validate → export
```

Every successful write automatically commits a Git revision, updates `operations.jsonl`, rebuilds `package.pptx`, and refreshes `.deckuse/index.json`. Use `undo` to revert writes and `history` to inspect the operation log.

It preserves untouched XML and unknown package parts where possible. It is not a full PowerPoint rendering or layout engine and cannot reliably judge whether a slide is visually attractive or whether a layout is visually correct. Use `monitor` for live HTML preview and `render` to screenshot one slide to PNG for agent visual review. Semantic `diff` / `branch` remain deferred past Phase 1a.

## Installation

Requirements: Node.js 18 or later.

```sh
npm install -g @deckflow/deckuse
```

This installs the `deckuse` CLI globally.

## CLI workflow

```sh
# Create a persistent workspace from a presentation (revision starts at 1).
deckuse init input.pptx ./workspace --json

# Inventory and read live properties with provenance.
deckuse status --workspace ./workspace --json
deckuse list slides --workspace ./workspace --json
deckuse list shapes --workspace ./workspace --slide 1 --json
deckuse get slide:1/shape:2 --workspace ./workspace --resolve both --json

# Mutate with semantic targets (one write = one revision).
deckuse set text slide:1/shape:2 --workspace ./workspace --value 'Hello' --json
deckuse set slide:1/shape:2 --workspace ./workspace --font.size 42 --fill.color '#0A2930' --json
deckuse add shape --workspace ./workspace --slide 1 --type text --name Title --x 0 --y 0 --width 914400 --height 457200 --json

# Validate, history, undo, export.
deckuse validate --workspace ./workspace --json
deckuse history --workspace ./workspace --json
deckuse undo --workspace ./workspace --steps 1 --json
deckuse export ./out.pptx --workspace ./workspace --json

# Live HTML preview; conversion starts when a browser subscribes.
deckuse monitor --workspace ./workspace --port 4173

# Screenshot one slide to PNG for visual review (requires Chrome / Chromium / Edge).
deckuse render --page 1 --workspace ./workspace --json
```

Global options include `--workspace`, `--json`, `--dry-run`, `--expect-revision`, and `--reason`. Run `deckuse --help` or `deckuse <command> --help` for the full CLI contract.

Workspace layout:

```text
workspace/
  source/           # unpacked OPC package; writes modify this directory
  package.pptx      # live Office snapshot rebuilt from source (not in Git)
  .deckuse/         # manifest, index, operations.jsonl, ignored monitor output
  .git/             # workspace version history
  .gitignore        # ignores package.* and other generated files
```

`apply` accepts a transaction file (`{ "operations": [...] }`), a single JSON mutation, a JSON array, or JSON Lines. One invocation can apply many write commands; multiple commands run as one atomic batch. Use `--input -` (the default) to read from standard input. Legacy ElementRef mutations remain supported. When invoked without a subcommand, the CLI accepts one complete protocol `2.0` JSON command on standard input.

Command results use a JSON envelope (`ok`, `command`, `revision`, `data` / `error`). Exit status `0` means success, `1` means that a command failed, and `2` means CLI usage or parsing failure.

### Selectors

Prefer `search text` / `search shape` and `list` for Phase 1a inventory. `query` remains available for back-compat and accepts either a selector string or a structured selector in a command. Space-separated terms are combined with AND.

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
```

After the write completes, `./year-update/package.pptx` is rebuilt automatically as the latest snapshot.

The review query limits the change to known occurrences; `replaceText` performs the approved bulk mutation while leaving unrelated objects intact. Without a selector, it updates the most specific indexed text nodes rather than ancestor containers that aggregate descendant text.

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

This is content and structural QA, not visual QA. Use `render` / `monitor` only as a human or agent review aid; Deckuse does not detect overlap or judge layout quality.

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

Create a separate workspace for each output from the approved master. Query the placeholders or existing customer text, apply only reviewed replacements, validate, and use the automatically updated `package.pptx`.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Apply reviewed replacements for this customer only.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
```

Separate workspaces prevent one customer’s edits from leaking into another output. Replace only the objects the approval process allows the agent to modify.

### 9. Produce regional or audience variants from one master

**Request:** “Generate regional and enterprise variants from the approved presentation.”

Initialize a fresh workspace from the same master for every variant. Each variant receives its own command file and output path. Prefer `apply` with a JSON array, JSONL, or `{ "operations": [...] }`: multiple write commands in one invocation run as one atomic batch (if one fails, none persist). The protocol `batch` command form remains supported.

```json
[
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
```

```sh
deckuse apply ./regional --input regional.json --json
```

This preserves a single approved source deck while making every variant reproducible from an explicit change set.

### 10. Let a coding agent operate an existing presentation

**Request:** “Inspect this deck, identify the requested edits, make them, and export a revised PPTX.”

Give the agent this loop: initialize a workspace, inspect or query before every targeted change, generate explicit JSON commands, apply them, validate the package, and use the rebuilt `package.pptx` as the export. Store the command file and command results alongside the task when auditability matters.

Deckuse gives the agent stable references, selectors, transactions, validation, and a deterministic export path. The agent provides task interpretation and decides which operations are appropriate.

## PPTX capabilities

- Persistent workspaces, revision-conflict detection, dry runs, atomic batches, and an operation log.
- `inspect`, `list`, `get`, `search`, and back-compat `query` / `getText`; stable references include slide ID, part URI, cNvPr ID, and ancestor path when available.
- `setText` and `replaceText`, including literal or regular-expression replacement in an optional selector scope. Without a selector, `replaceText` prefers leaf text nodes over ancestor containers that aggregate descendant text. Newlines in `setText` become separate paragraphs.
- `setTransform` for explicit object position, size, rotation, and flip changes.
- `setProperties` for common shape and text properties, including `paragraph.align`, `paragraph.level`, `bullet`, `fill` transparency, and `hyperlink`.
- Add, duplicate, and remove slides; duplicated slides clone mutable notes and chart parts while layouts and media can be shared safely.
- Add shapes/text boxes (optional `role` writes a `p:ph` placeholder), connectors, groups, pictures (from a file path or base64), tables, charts (cache-only), and embedded video/audio; duplicate or remove elements.
- `role` must be an OOXML placeholder type (`title`, `body`, `subTitle`, `ctrTitle`, …). Common aliases like `subtitle`→`subTitle` are normalized; non-OOXML labels (for example `card`) are rejected so PowerPoint does not prompt to repair.
- Address placeholders with `slide:N/placeholder:<type>` (for example `title`, `body`, `subTitle`, `ctrTitle`).
- `replacePicture` replaces a picture’s embedded media in place while retaining its element reference and layer order.
- Table-cell addressing by table ID, row, and column; table row/column insert and delete via `setProperties`; cell `fill`; speaker-note reading and text editing (notes parts are created automatically when writing `slide:N/notes` if missing).
- Create charts (`bar` / `column` / `line` / `pie`) and edit chart title, series-name, and cached values. When an embedded workbook exists, Deckuse emits `EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED` rather than claiming that workbook data was updated. Advanced charts (other families, combo, ChartEx) are preserve-only in the community edition.
- List and resolve master, layout, and theme parts; community edition rejects writes to those parts (`UNSUPPORTED_CAPABILITY`). Master/layout editing is available in the commercial edition repository.
- `monitor` for live HTML preview and `render` for single-slide PNG screenshots (office2html + Playwright).
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
- It is not a full PowerPoint rendering or layout engine. `monitor` and `render` provide HTML/PNG review aids only; do not rely on them to assess visual quality, detect overlap, or automatically improve slide design.
- Chart creation and edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Embedded video/audio use a generated poster frame; playback timing and advanced media options are not edited.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text within each paragraph into one run while retaining the first run’s style; newlines in `setText` create separate paragraphs.

## Development checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
