<div align="center">

# Deckuse

[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse é um mecanismo local-first e orientado por esquema para automatização de documentos Office por agentes de código. Ele abre um documento em um espaço de trabalho versionado, permite que um agente inspecione e selecione sua estrutura, aplica comandos JSON explícitos, valida o resultado e exporta um novo documento.

PPTX é o formato atualmente implementado. Os adaptadores DOCX, XLSX, Keynote e Numbers retornam deliberadamente `FORMAT_NOT_IMPLEMENTED`; eles ainda não são destinos de edição suportados.

## Por que usar o Deckuse

O Deckuse permite modificar uma apresentação existente sem recriá-la do zero. O fluxo de trabalho prioriza deliberadamente a estrutura, e não o visual:

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → commit → updated.pptx
```

Ele preserva, sempre que possível, XML não modificado e partes desconhecidas do pacote. Não é um mecanismo de renderização e não consegue avaliar com confiança se um slide é atraente ou se o layout visual está correto.

## Instalação

Requisitos: Node.js 24 ou posterior e pnpm 10.

```sh
pnpm install
pnpm install:global
```

O segundo comando instala globalmente a CLI local `deckuse`. Durante o desenvolvimento do repositório, execute-o novamente depois de recompilar a CLI.

```sh
pnpm build
pnpm install:global
```

```sh
# Criar um espaço de trabalho persistente a partir de uma apresentação.
deckuse init input.pptx ./workspace --json

# Inspecionar o documento indexado e consultar elementos de destino.
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# Aplicar um comando JSON, uma matriz JSON ou JSONL.
deckuse apply ./workspace --input operations.jsonl --json

# Validar o pacote e exportar.
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
```

## Fluxo de trabalho da CLI

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command.

Os resultados dos comandos são gravados em JSON na saída padrão; erros de argumentos ou entrada inválidos são gravados na saída de erro. O status `0` indica sucesso, `1` indica falha de comando e `2` indica falha de uso ou análise da CLI.

### Seletores

`query` accepts either a selector string or a structured selector in a command. Space-separated terms are combined with AND.

| Syntax                                 | Meaning                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `*` or `all`                           | Match every indexed element.                         |
| `kind=textbox`                         | Match an element kind by case-insensitive substring. |
| `text=Quarter`                         | Match text that contains the literal value.          |
| `text~=pattern`                        | Match text with a Unicode regular expression.        |
| `hasText=true`                         | Match elements that contain text.                    |
| `slide=256`, `id=256:10`, `name=Title` | Filter by slide ID, element ID, or name.             |

Query results provide stable element references. A reference includes a document ID and an element ID or structural path; array positions are not stable identifiers.

## Fluxos de trabalho comuns para agentes

Deckuse primitives support these reproducible agent workflows. The agent is responsible for reasoning, copywriting, and visual review; Deckuse does not claim to perform them independently.

1. **Update an outdated year:** query `FY2025`, then perform a literal `replaceText` to `FY2026`, validate, and export.
2. **Rename a company or product:** review the exact old name first, then apply a literal replacement; use regular expressions only after reviewing the query output.
3. **Extract a presentation outline:** run `inspect` and query `hasText=true`; the agent groups returned objects by slide and identifies titles.
4. **Run pre-delivery content QA:** query old customer names, dates, product names, URLs, and required disclaimer text. This is structural/content QA, not visual QA.
5. **Change one item on one slide:** query the target, use the returned `ref` in `setText`, then validate.
6. **Standardize title typography:** query and approve title references, then apply `setProperties` to each reference.
7. **Adjust geometry precisely:** inspect target objects and issue explicit `setTransform` commands with EMU coordinates.
8. **Personalize an approved sales deck:** create a separate workspace per customer, apply reviewed replacements only, validate, and commit to a distinct file.
9. **Produce regional or audience variants:** initialize a fresh workspace per variant and use an atomic `batch` when all changes must succeed together.
10. **Let a coding agent operate an existing presentation:** initialize, inspect/query before each change, generate explicit JSON commands, apply, validate, and commit.

### Exemplo de `setProperties`

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

## Recursos de PPTX

- Persistent workspaces, revision-conflict detection, dry runs, atomic batches, and an operation log.
- `inspect`, `query`, and `getText`; stable references include slide ID, part URI, cNvPr ID, and ancestor path when available.
- `setText` and `replaceText`, including literal or regular-expression replacement in an optional selector scope.
- `setTransform` for explicit object position, size, rotation, and flip changes.
- `setProperties` for common shape and text properties.
- Add, duplicate, and remove slides; duplicated slides clone mutable notes and chart parts while layouts and media can be shared safely.
- Add shapes/text boxes, connectors, groups, pictures (from a file path or base64), and tables; duplicate or remove elements.
- `replacePicture` replaces embedded media in place while retaining the element reference and layer order.
- Table-cell addressing; speaker-note reading and text editing.
- Chart title, series-name, and cached-value edits. An embedded workbook causes `EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED` rather than a claim that workbook data was updated.
- Common text and `srgbClr` color edits in master, layout, and theme parts.
- Preservation of unknown parts and untouched nodes. ZIP files are recompressed, so fidelity refers to uncompressed data for untouched entries, not ZIP byte identity.

## Limitações

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## Verificações de desenvolvimento

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
