<div align="center">

# Deckuse

[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse は、コーディングエージェント向けのローカルファーストかつスキーマ駆動の Office 文書自動化エンジンです。文書をバージョン管理されたワークスペースとして開き、エージェントが構造を検査・対象指定し、明示的な JSON コマンドを適用、検証して新しい文書を出力できます。

現在実装されている形式は PPTX です。DOCX、XLSX、Keynote、Numbers のアダプターは意図的に `FORMAT_NOT_IMPLEMENTED` を返します。これらはまだ編集対象としてサポートされていません。

## Deckuse を使う理由

Deckuse は既存のプレゼンテーションを作り直さずに変更できます。ワークフローは視覚ではなく構造を重視して設計されています。

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → commit → updated.pptx
```

未変更の XML と未知のパッケージ部品を可能な限り保持します。レンダリングエンジンではないため、スライドの見栄えやレイアウトの正しさを確実に判断することはできません。

## インストール

要件：Node.js 24 以降および pnpm 10。

```sh
pnpm install
pnpm install:global
```

2 番目のコマンドはローカルの `deckuse` CLI をグローバルにインストールします。リポジトリ開発中は、CLI を再ビルドした後にもう一度実行してください。

```sh
pnpm build
pnpm install:global
```

```sh
# プレゼンテーションから永続ワークスペースを作成します。
deckuse init input.pptx ./workspace --json

# インデックス済み文書を検査し、対象要素をクエリします。
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# 1 つの JSON コマンド、JSON 配列、または JSONL を適用します。
deckuse apply ./workspace --input operations.jsonl --json

# パッケージを検証してエクスポートします。
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
```

## CLI ワークフロー

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command.

コマンド結果は JSON として標準出力に書き込まれます。無効な引数または入力によるエラーは標準エラー出力に書き込まれます。終了コード `0` は成功、`1` はコマンド失敗、`2` は CLI の使用法または解析の失敗です。

### セレクター

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

## 一般的なエージェントのワークフロー

これらの例では、現在の PPTX 機能のみを使用します。Deckuse が推論、文案作成、または視覚的レビューを単独で実行すると主張するものではなく、エージェントが Deckuse のプリミティブを組み合わせて構成できるワークフローを説明します。

### 1. プレゼンテーション全体で古い年度を更新する

**リクエスト:** 「すべての `FY2025` を `FY2026` に変更し、それ以外は変更しないでください。」

まず `query` で影響を受ける要素を確認し、その後リテラルな `replaceText` を実行してから、エクスポート前に検証します。

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

レビュー用のクエリにより、変更対象を既知の出現箇所に限定できます。`replaceText` は承認済みの一括変更を実行し、無関係なオブジェクトはそのまま保持します。

### 2. 会社名または製品名を変更する

**リクエスト:** 「古い製品名を新しい製品名にすべて置き換えてください。」

これは同じく、安全な「レビューしてから置換する」パターンです。まず正確な旧名称を検索し、次にリテラルな値で `replaceText` を使用します。句読点やスペースなどの表記ゆれには、クエリ出力を確認した後にのみ正規表現による置換を使用してください。

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

より限定的に変更するには、たとえばコマンドに `"selector": "slide=256"` を含め、1 枚のスライドだけを対象にできます。

### 3. エージェント用にプレゼンテーションのアウトラインを抽出する

**リクエスト:** 「スライドのタイトルを一覧にして、この資料が扱う内容を要約してください。」

`inspect` を実行してインデックス化されたプレゼンテーション構造を取得し、その後テキストを持つオブジェクトをクエリします。呼び出し側のエージェントは、返されたオブジェクトをスライド ID ごとにグループ化し、名前・位置・テキストからタイトルらしいオブジェクトを特定して、抽出したテキストに基づき要約を生成できます。

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse は構造化されたソースデータを提供します。どのテキストがタイトルかを判断し、要約を書く責任を負うのは Deckuse ではなくエージェントです。

### 4. 納品前のコンテンツ QA を実行する

**リクエスト:** 「この資料を送付する前に、古い顧客名、日付、製品名、URL、必須の免責事項テキストを見つけてください。」

既知のリスクごとにクエリを実行し、返された参照を確認します。欠落の確認も同じです。必須テキストをクエリし、結果が空であればフラグを立てます。エージェントはプレゼンテーションを変更せずに QA レポートを作成することも、承認済みの修正に向けて対象を限定した `setText` / `replaceText` コマンドを準備することもできます。

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

これはコンテンツおよび構造の QA であり、視覚 QA ではありません。Deckuse はスライドをレンダリングせず、テキストが他のコンテンツと重なっているかどうかも判定しません。

### 5. 1 枚のスライド上の 1 項目だけを変更する

**リクエスト:** 「スライド 7 のタイトルを `Enterprise Strategy` に変更し、それ以外は変更しないでください。」

まずそのスライドとタイトルテキストをクエリし、返された `ref` を取得して `setText` コマンドを送ります。`ref` により、曖昧なグローバル置換を防げます。

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

要素 ID はプレゼンテーション固有の例です。この値をコピーするのではなく、必ず現在のワークスペースから返された ID を使用してください。

### 6. タイトルの書式を標準化する

**リクエスト:** 「承認済みのすべてのタイトルを 28 pt にし、承認済みの書体を使用してください。」

クエリでタイトルオブジェクトを特定し、エージェントに返された参照をレビューまたはフィルタリングさせ、承認済みの各参照に対して `setProperties` を 1 回ずつ適用します。`setProperties` は一度に 1 つの参照を対象とし、セレクター自体は受け取りません。

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

同じコマンドで `fill`、`stroke`（`border`、`outline`、`line` も可）、`textColor`、`italic`、`underline`、`name`、`hidden` を設定できます。不明なプロパティキーは `INVALID_COMMAND` で失敗します。

### 7. オブジェクトのジオメトリを正確に調整する

**リクエスト:** 「承認済みの各タイトルを少し下に移動してください。」

対象のタイトル参照をクエリして選択し、現在のジオメトリを検査してから、明示的な座標を持つ `setTransform` コマンドをオブジェクトごとに 1 件ずつ発行します。これは構造的なジオメトリ操作です。視覚的な検証なしに、自動レイアウト修正として説明しないでください。

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

変換座標は OOXML EMU です。垂直位置だけを変更する場合は、検査済みオブジェクトの `x`、`width`、`height` を保持してください。

### 8. 承認済みの営業資料をパーソナライズする

**リクエスト:** 「見込み顧客向けのバージョンを作成してください。顧客名と承認済みのアカウント固有文面を更新しますが、デザインは維持してください。」

承認済みのマスターから、出力ごとに別々のワークスペースを作成します。プレースホルダーまたは既存の顧客テキストをクエリし、レビュー済みの置換だけを適用して、検証し、別のファイルにコミットします。

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Apply reviewed replacements for this customer only.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
deckuse commit ./customer-a -o customer-a-deck.pptx --json
```

ワークスペースを分離することで、ある顧客向けの編集が別の出力に混入するのを防ぎます。承認プロセスでエージェントに変更を許可されたオブジェクトだけを置換してください。

### 9. 1 つのマスターから地域別または対象者別のバリアントを作成する

**リクエスト:** 「承認済みのプレゼンテーションから、地域別とエンタープライズ向けのバリアントを生成してください。」

各バリアントについて、同じマスターから新しいワークスペースを初期化します。各バリアントには専用のコマンドファイルと出力パスを割り当てます。あるバリアントの変更をアトミックにする必要がある場合は `batch` を使用します。1 つでもコマンドが失敗すれば、そのバッチ内の変更は一切永続化されません。

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

これにより、単一の承認済みソース資料を維持しながら、明示的な変更セットから各バリアントを再現できます。

### 10. コーディングエージェントに既存のプレゼンテーションを操作させる

**リクエスト:** 「この資料を検査し、依頼された編集を特定して実行し、修正済みの PPTX をエクスポートしてください。」

エージェントには次のループを与えます。ワークスペースを初期化し、対象を限定した変更ごとに事前に検査またはクエリを実行し、明示的な JSON コマンドを生成して適用し、パッケージを検証して新しい出力にコミットします。監査可能性が重要な場合は、コマンドファイルとコマンド結果をタスクと一緒に保存します。

Deckuse は、エージェントに安定した参照、セレクター、トランザクション、検証、および決定論的なエクスポート経路を提供します。タスクを解釈し、どの操作が適切かを判断するのはエージェントです。

### `setProperties` の例

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

## PPTX の機能

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

## 制限事項

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## 開発時のチェック

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
