<div align="center">

# Deckuse

[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse는 코딩 에이전트를 위한 로컬 우선, 스키마 기반 Office 문서 자동화 엔진입니다. 문서를 버전 관리되는 작업 공간으로 열고, 에이전트가 구조를 검사하고 대상 요소를 지정하여 명시적인 JSON 명령을 적용·검증한 뒤 새 문서로 내보낼 수 있게 합니다.

현재 구현된 형식은 PPTX입니다. DOCX, XLSX, Keynote 및 Numbers 어댑터는 의도적으로 `FORMAT_NOT_IMPLEMENTED`를 반환하며, 아직 지원되는 편집 대상이 아닙니다.

## Deckuse를 선택하는 이유

Deckuse는 프레젠테이션을 처음부터 다시 만들지 않고 기존 파일을 수정합니다. 이 워크플로는 시각적 판단보다 구조를 우선하도록 설계되었습니다.

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → commit → updated.pptx
```

가능한 경우 변경하지 않은 XML과 알려지지 않은 패키지 파트를 보존합니다. 렌더링 엔진이 아니므로 슬라이드의 시각적 품질이나 레이아웃 정확성을 신뢰성 있게 판단할 수 없습니다.

## 설치

요구 사항: Node.js 24 이상 및 pnpm 10.

```sh
pnpm install
pnpm install:global
```

두 번째 명령은 로컬 `deckuse` CLI를 전역 설치합니다. 저장소 개발 중에는 CLI를 다시 빌드한 후 이 명령을 다시 실행하세요.

```sh
pnpm build
pnpm install:global
```

```sh
# 프레젠테이션에서 영구 작업 공간을 만듭니다.
deckuse init input.pptx ./workspace --json

# 인덱싱된 문서를 검사하고 대상 요소를 조회합니다.
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# JSON 명령 하나, JSON 배열 또는 JSONL을 적용합니다.
deckuse apply ./workspace --input operations.jsonl --json

# 패키지를 검증하고 내보냅니다.
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
```

## CLI 워크플로

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command.

명령 결과는 JSON으로 표준 출력에 기록됩니다. 잘못된 인수 또는 입력 오류는 표준 오류로 기록됩니다. 종료 상태 `0`은 성공, `1`은 명령 실패, `2`는 CLI 사용법 또는 파싱 실패를 뜻합니다.

### 선택자

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

## 일반적인 에이전트 워크플로

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

### `setProperties` 예시

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

## PPTX 기능

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

## 제한 사항

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## 개발 검사

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
