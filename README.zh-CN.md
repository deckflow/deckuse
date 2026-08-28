<div align="center">

# Deckuse

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse 是一款面向编程智能体的本地优先、模式驱动的 Office 文档自动化引擎。它将文档打开为带版本的工作区，让智能体检查并精确定位其结构，执行显式 JSON 命令、验证结果，再导出新文档。

目前已实现 PPTX。DOCX、XLSX、Keynote 和 Numbers 适配器会明确返回 `FORMAT_NOT_IMPLEMENTED`；它们尚不是受支持的编辑目标。

## 为何选择 Deckuse

Deckuse 可在不从零重建演示文稿的情况下修改现有 PPT。其工作流刻意以结构为中心，而非视觉为中心：

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → package.pptx
```

每次成功的写操作会自动提交 Git 版本、更新 `operations.jsonl`，并立即重新打包 `package.pptx`。可使用 `undo` 撤销、`history` 查看操作历史。

Deckuse 会尽可能保留未修改的 XML 和未知的包部件。它不是渲染引擎，无法可靠判断幻灯片是否美观或版式是否正确。

## 安装

要求：Node.js 18 或更高版本。

```sh
npm install -g @deckflow/deckuse
```

该命令会全局安装 `deckuse` CLI。

```sh
# 从演示文稿创建持久工作空间。
deckuse init input.pptx ./workspace --json

# 检查已索引的文档并查询目标元素。
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# 应用一个 JSON 命令、JSON 数组或 JSONL。
deckuse apply ./workspace --input operations.jsonl --json

# 验证工作区、查看历史、撤销写操作。
deckuse validate ./workspace --json
deckuse history ./workspace --json
deckuse undo ./workspace --steps 1 --json
```

工作区布局：

```text
workspace/
  source/           # 解压后的 OPC 包，写操作直接修改此处
  package.pptx      # 由 source 即时打包的 Office 快照（不在 Git 中）
  .deckuse/         # manifest、index、operations.jsonl
  .git/             # 工作区版本历史
  .gitignore        # 忽略 package.* 等生成文件
```

## CLI 工作流

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Multiple commands in one `apply` invocation are executed as one atomic batch. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before the batch.

命令结果以 JSON 写入标准输出；无效参数或输入导致的错误写入标准错误。退出状态 `0` 表示成功，`1` 表示命令失败，`2` 表示 CLI 用法或解析失败。

### 选择器

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

## 通用智能体工作流

这些示例仅使用当前 PPTX 功能。它们描述了智能体如何从 Deckuse 基元组合出工作流，而非声称 Deckuse 可独立进行推理、文案撰写或视觉审查。

### 1. 跨整个演示文稿更新过期年份

**Request：**“将每处 `FY2025` 引用改为 `FY2026`，不要改动其他内容。”

先使用 `query` 审查受影响的元素，然后执行字面量 `replaceText`，并在导出前验证。

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

写操作完成后，`./year-update/package.pptx` 会自动更新为最新快照。

审查查询将变更限定在已知出现位置；`replaceText` 执行经批准的批量修改，同时保持无关对象不变。

### 2. 重命名公司或产品

**Request：**“将旧产品名称在所有位置替换为新产品名称。”

这沿用同一套安全的“审查后替换”模式。先搜索准确的旧名称，再用字面量值执行 `replaceText`。对于标点或空格等变体，只有在检查查询输出后才使用正则表达式替换。

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

若要进一步收窄变更范围，请在命令中加入选择器，例如 `"selector": "slide=256"`，使其仅对一张幻灯片生效。

### 3. 为智能体提取演示文稿大纲

**Request：**“列出各页幻灯片标题并总结此演示文稿涵盖的内容。”

运行 `inspect` 获取已索引的演示文稿结构，然后查询含有文本的对象。调用方智能体可按幻灯片 ID 对返回对象分组，根据其名称、位置或文本识别标题类对象，并基于提取出的文本生成摘要。

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse 提供结构化源数据。由智能体而非 Deckuse 决定哪些文本是标题，并撰写摘要。

### 4. 执行交付前内容 QA

**Request：**“在发送此演示文稿前，找出旧客户名称、日期、产品名称、URL 和必需的免责声明文本。”

查询每项已知风险并检查返回的引用。缺失检查的工作方式相同：查询所需文本，并标记空结果。智能体可以在不修改演示文稿的前提下生成 QA 报告，也可以为经批准的修复准备精确定位的 `setText` / `replaceText` 命令。

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

这是内容和结构 QA，不是视觉 QA。Deckuse 不渲染幻灯片，也不判断文本是否与其他内容重叠。

### 5. 仅修改一张幻灯片上的一个项目

**Request：**“在第 7 张幻灯片上，将标题改为 `Enterprise Strategy`；不要改动其他内容。”

先查询该幻灯片及标题文本，然后取返回的 `ref` 发送 `setText` 命令。`ref` 可避免含义不明确的全局替换。

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

元素 ID 是特定于演示文稿的示例。务必使用当前工作区返回的 ID，而不要复制此值。

### 6. 统一标题排版

**Request：**“将每个经批准的标题设为 28 pt，并使用已批准的字体。”

使用查询识别标题对象，让智能体审查或筛选返回的引用，然后对每个已批准的引用分别应用一次 `setProperties`。`setProperties` 一次只针对一个引用；它本身不接受选择器。

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

同一命令还可设置 `fill`、`stroke`（也可写作 `border`、`outline` 或 `line`）、`textColor`、`italic`、`underline`、`name` 和 `hidden`。未知属性键会以 `INVALID_COMMAND` 失败。

### 7. 精确调整对象几何属性

**Request：**“将每个经批准的标题稍微向下移动。”

查询并选择目标标题引用，检查它们当前的几何属性，然后为每个对象发出一条带有明确坐标的 `setTransform` 命令。这是结构化的几何操作；未经视觉验证，不应将其表述为自动版式修复。

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

变换坐标使用 OOXML EMU。若仅更改其垂直位置，请保留检查所得对象的 `x`、`width` 和 `height`。

### 8. 将已批准的销售演示文稿个性化

**Request：**“为潜在客户创建一个版本。更新客户名称和已批准的特定客户文案，但保留设计。”

从已批准的母版为每份输出创建独立工作区。查询占位符或现有客户文本，仅应用经审查的替换，验证后使用自动更新的 `package.pptx`。

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# 仅应用针对此客户的经审查替换。
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
```

独立工作区可防止某一客户的编辑泄漏到另一份输出中。仅替换审批流程允许智能体修改的对象。

### 9. 从同一母版生成区域或受众变体

**Request：**“从已批准的演示文稿生成区域版和企业版变体。”

从同一母版为每个变体初始化新的工作区。每个变体都有自己的命令文件和输出路径。当一个变体的全部更改必须具备原子性时，使用 `batch`：若任一命令失败，批次中的所有变更均不会持久化。

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

这既保留了一份已批准的源演示文稿，也使每个变体都能从显式变更集复现。

### 10. 让编程智能体操作现有演示文稿

**Request：**“检查此演示文稿，识别所需编辑，完成编辑并导出修订后的 PPTX。”

向智能体提供以下循环：初始化工作区；在每次针对性变更前执行检查或查询；生成显式 JSON 命令；应用命令；验证包；提交新的输出。当可审计性很重要时，将命令文件和命令结果与任务一同保存。

Deckuse 为智能体提供稳定引用、选择器、事务、验证和确定性的导出路径。智能体负责理解任务，并决定哪些操作适用。

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

## PPTX 功能

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

## 限制

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## 开发检查

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
