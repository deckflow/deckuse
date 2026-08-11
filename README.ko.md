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

이 예시는 현재 PPTX 기능만 사용합니다. Deckuse가 추론, 카피라이팅 또는 시각적 검토를 독립적으로 수행한다고 주장하는 것이 아니라, 에이전트가 Deckuse 프리미티브를 조합하여 구성할 수 있는 워크플로를 설명합니다.

### 1. 프레젠테이션 전체에서 오래된 연도 업데이트

**요청:** “모든 `FY2025` 참조를 `FY2026`으로 바꾸고, 그 외에는 아무것도 변경하지 마세요.”

먼저 `query`로 영향을 받는 요소를 검토한 다음, 리터럴 `replaceText`를 수행하고 내보내기 전에 검증합니다.

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

검토 쿼리는 변경 범위를 확인된 항목으로 제한합니다. `replaceText`는 승인된 일괄 변경을 수행하면서 관련 없는 객체는 그대로 유지합니다.

### 2. 회사 또는 제품 이름 변경

**요청:** “기존 제품 이름을 새 제품 이름으로 모든 곳에서 바꾸세요.”

이는 동일한 안전한 검토 후 교체 패턴입니다. 먼저 정확한 기존 이름을 검색한 뒤, 리터럴 값으로 `replaceText`를 사용합니다. 구두점이나 공백처럼 변형이 있는 경우에는 쿼리 출력을 확인한 후에만 정규식 교체를 사용하세요.

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

더 제한적인 변경을 위해서는 명령에 예를 들어 `"selector": "slide=256"` 같은 선택자를 포함하여 하나의 슬라이드만 대상이 되게 하세요.

### 3. 에이전트용 프레젠테이션 개요 추출

**요청:** “슬라이드 제목을 나열하고 이 덱이 다루는 내용을 요약하세요.”

`inspect`를 실행하여 인덱싱된 프레젠테이션 구조를 가져온 다음 텍스트가 있는 객체를 쿼리합니다. 호출하는 에이전트는 반환된 객체를 슬라이드 ID별로 그룹화하고, 이름·위치·텍스트를 기준으로 제목처럼 보이는 객체를 식별하며, 추출된 텍스트에서 요약을 생성할 수 있습니다.

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse는 구조화된 원본 데이터를 제공합니다. 어떤 텍스트가 제목인지 결정하고 요약을 작성하는 일은 Deckuse가 아니라 에이전트의 책임입니다.

### 4. 발송 전 콘텐츠 QA 실행

**요청:** “이 덱을 보내기 전에 이전 고객명, 날짜, 제품명, URL 및 필수 면책 문구를 찾으세요.”

알려진 각 위험 항목을 쿼리하고 반환된 참조를 검사합니다. 부재 확인도 같은 방식으로 동작합니다. 필수 텍스트를 쿼리하고 결과가 비어 있으면 표시합니다. 에이전트는 프레젠테이션을 수정하지 않고 QA 보고서를 만들거나, 승인된 수정 사항에 대해 범위를 좁힌 `setText` / `replaceText` 명령을 준비할 수 있습니다.

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

이는 콘텐츠 및 구조 QA이지 시각 QA가 아닙니다. Deckuse는 슬라이드를 렌더링하지 않으며 텍스트가 다른 콘텐츠와 겹치는지 판단하지 않습니다.

### 5. 한 슬라이드에서 정확히 하나의 항목 변경

**요청:** “슬라이드 7에서 제목을 `Enterprise Strategy`로 바꾸고, 그 외에는 아무것도 변경하지 마세요.”

먼저 해당 슬라이드와 제목 텍스트를 쿼리한 뒤, 반환된 `ref`를 가져와 `setText` 명령을 보냅니다. `ref`는 모호한 전역 교체를 방지합니다.

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

요소 ID는 프레젠테이션별 예시입니다. 이 값을 복사하지 말고 항상 현재 작업 공간에서 반환된 ID를 사용하세요.

### 6. 제목 타이포그래피 표준화

**요청:** “승인된 모든 제목을 28 pt로 만들고 승인된 서체를 사용하세요.”

쿼리로 제목 객체를 식별하고, 에이전트가 반환된 참조를 검토하거나 필터링한 다음 승인된 각 참조에 대해 `setProperties`를 한 번씩 적용합니다. `setProperties`는 한 번에 하나의 참조만 대상으로 하며, 자체적으로 선택자를 받지 않습니다.

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

같은 명령으로 `fill`, `stroke`(`border`, `outline`, `line`도 가능), `textColor`, `italic`, `underline`, `name`, `hidden`을 설정할 수 있습니다. 알 수 없는 속성 키는 `INVALID_COMMAND`로 실패합니다.

### 7. 객체의 기하를 정밀하게 조정

**요청:** “승인된 모든 제목을 약간 아래로 이동하세요.”

의도한 제목 참조를 쿼리하고 선택한 다음 현재 기하 정보를 검사하고, 명시적 좌표를 포함하여 객체마다 하나의 `setTransform` 명령을 실행합니다. 이는 구조적 기하 작업이므로, 시각적 검증 없이 자동 레이아웃 보정으로 홍보해서는 안 됩니다.

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

변환 좌표는 OOXML EMU입니다. 세로 위치만 변경할 때는 검사한 객체의 `x`, `width`, `height`를 유지하세요.

### 8. 승인된 영업 덱 개인화

**요청:** “잠재 고객용 버전을 만드세요. 고객 이름과 승인된 계정별 문구는 업데이트하되 디자인은 유지하세요.”

승인된 마스터에서 각 출력물마다 별도의 작업 공간을 만듭니다. 플레이스홀더 또는 기존 고객 텍스트를 쿼리하고, 검토된 교체만 적용한 뒤 검증하고 별도의 파일에 커밋합니다.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Apply reviewed replacements for this customer only.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
deckuse commit ./customer-a -o customer-a-deck.pptx --json
```

별도 작업 공간은 한 고객의 편집 내용이 다른 출력물로 새어 나가는 것을 방지합니다. 승인 절차가 에이전트의 수정을 허용한 객체만 교체하세요.

### 9. 하나의 마스터에서 지역 또는 대상별 변형 생성

**요청:** “승인된 프레젠테이션에서 지역별 및 엔터프라이즈 변형을 생성하세요.”

각 변형마다 동일한 마스터에서 새 작업 공간을 초기화합니다. 각 변형은 고유한 명령 파일과 출력 경로를 가집니다. 변형의 변경 사항이 원자적이어야 하는 경우 `batch`를 사용하세요. 하나의 명령이 실패하면 일괄 변경 중 어느 것도 지속되지 않습니다.

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

이 방식은 하나의 승인된 원본 덱을 보존하면서, 명시적인 변경 집합으로 모든 변형을 재현할 수 있게 합니다.

### 10. 코딩 에이전트가 기존 프레젠테이션을 조작하도록 하기

**요청:** “이 덱을 검사하고, 요청된 편집을 식별하여 적용한 뒤 수정된 PPTX를 내보내세요.”

에이전트에 다음 루프를 제공합니다. 작업 공간을 초기화하고, 대상 변경 전마다 inspect 또는 query를 실행하며, 명시적인 JSON 명령을 생성하고 적용한 뒤 패키지를 검증하고 새 출력물로 커밋합니다. 감사 가능성이 중요한 경우 명령 파일과 명령 결과를 작업과 함께 저장하세요.

Deckuse는 에이전트에 안정적인 참조, 선택자, 트랜잭션, 검증 및 결정론적인 내보내기 경로를 제공합니다. 작업을 해석하고 어떤 작업이 적절한지 결정하는 것은 에이전트입니다.

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
