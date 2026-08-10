# Deckuse

Deckuse 是一个以版本化 JSON 命令驱动的 Node.js Office 自动化工具。当前真实可用的格式为 PPTX；DOCX、XLSX、Keynote 和 Numbers adapter 仍会明确返回 `FORMAT_NOT_IMPLEMENTED`。

## CLI

```sh
deckuse init input.pptx ./workspace --json
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=季度' --json
deckuse query ./workspace '*' --limit 500 --json
deckuse query ./workspace 'hasText=true text~=[\u4e00-\u9fff]' --json
deckuse apply ./workspace --input operations.jsonl --json
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
deckuse commit ./workspace -o output.pptx --force --json
```

不带子命令时仍接受 stdin 中的单个 JSON command。`apply` 接受单 JSON、JSON 数组或 JSONL，`--input -` 表示 stdin。stdout 只输出结果 JSON，参数和输入错误写 stderr；退出码 0/1/2 分别表示成功、命令执行失败、CLI 使用或解析错误。

### Agent 工作流示例（翻译）

```sh
deckuse init deck.pptx ./ws --json
deckuse query ./ws 'hasText=true text~=[\u4e00-\u9fff]' --limit 1000 --json
# 根据 query 结果准备 replaceText 操作，再一次 apply：
cat > ops.json <<'EOF'
[
  {"type":"replaceText","find":"季度目标","replace":"Quarterly Goals"},
  {"type":"replaceText","find":"温度","replace":"Temperature"}
]
EOF
deckuse apply ./ws --input ops.json --json
deckuse validate ./ws --json
deckuse commit ./ws -o deck.en.pptx --force --json
```

`query` selector：

| 写法                                     | 含义                             |
| ---------------------------------------- | -------------------------------- |
| `*` / `all`                              | 匹配全部元素                     |
| `kind=textbox`                           | 按 kind 子串匹配（大小写不敏感） |
| `text=季度`                              | 文本包含                         |
| `text~=正则`                             | 文本正则（`u` flag）             |
| `hasText=true`                           | 仅有文本的元素                   |
| `slide=256` / `id=256:10` / `name=Title` | 其它字段过滤；空格连接为 AND     |

## PPTX 能力

- 持久化 workspace、revision 冲突检测、dry-run、原子 batch 和操作日志。
- inspect/query/getText；稳定引用包含 slide ID、part URI、cNvPr ID/祖先链。
- `replaceText`：按字面量或正则在可选 selector 范围内批量替换文本（可放入 `batch`）。
- `commit.overwrite` / CLI `--force`：允许覆盖已存在的输出文件。
- 新增空白 slide、复制 slide、删除 slide。复制 slide 时克隆 notes/chart 可变 part，layout 和 media 可安全共享。
- shape/textbox、connector、group、picture（文件路径或 base64）、table 的新增；元素文本、位置、删除和复制。
- `replacePicture`：按 `path` 或 `base64` 原地替换 picture 的嵌入媒体，保留元素引用与图层顺序；扩展名不变时覆盖原 media part，变化时写入新 part 并清理未引用旧媒体。
- 删除 picture 或 slide 时，会移除未再被引用的 image relationship / media part（共享媒体在仍有引用时保留）。
- 表格单元格按 table ID、行、列稳定寻址；speaker notes 读取和文本修改。
- chart 标题、系列名和数值 cache 修改。存在嵌入 workbook 时返回 `EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED` warning，workbook 不会被静默声称已同步。
- master/layout/theme 文本和 `srgbClr` 常见颜色修改（`setText` / `setProperties`）。
- `setProperties` 支持常见形状/文本属性：`fill`、`stroke`（别名 `border`/`outline`/`line`）、`textColor`、`fontFamily`、`fontSize`、`bold`/`italic`/`underline`、`name`、`hidden`；未知 key 会返回 `INVALID_COMMAND`。
- 未知 part 和未触碰节点保留；ZIP 会重新压缩，因此仅保证未修改 entry 的解压数据摘要一致。

#### setProperties 示例

```json
{
  "type": "setProperties",
  "ref": { "documentId": "./ws", "elementId": "256:8" },
  "properties": {
    "stroke": { "color": "0000FF", "width": 1.5 },
    "fill": "none",
    "textColor": "111111",
    "fontSize": 18,
    "fontFamily": "Noto Sans SC",
    "bold": true
  }
}
```

`stroke` / `fill` 可用 hex 字符串，或 `none` / `false` / `null` 表示无描边/无填充。`stroke.width` 单位为 pt（默认 1）。

完整命令 schema 位于 `packages/core/schema/command.schema.json`，API 入口为 `@deckflow/deckuse-core`、`@deckflow/deckuse-opc` 与 `@deckflow/deckuse-pptx`。

## 限制

- 不实现 PowerPoint 的全部 DrawingML、动画、SmartArt、OLE 和宏编辑。
- 图表仅同步 OOXML chart cache；不重写嵌入 Excel workbook。
- 复制 slide 会克隆 notes/chart，复用 layout/theme/media。复杂自定义 XML 扩展会原样保留，但不会做语义级编辑。
- `setText` / `replaceText` 会把目标节点的多 run 文本折叠为单个 run（保留首 run 样式）。

```sh
pnpm install
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
