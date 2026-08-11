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

Estes exemplos usam apenas os recursos atuais de PPTX. Eles descrevem fluxos de trabalho que um agente pode compor a partir dos elementos básicos do Deckuse, sem afirmar que o Deckuse realiza de modo independente raciocínio, redação ou revisão visual.

### 1. Atualizar um ano desatualizado em toda uma apresentação

**Solicitação:** “Altere todas as referências a `FY2025` para `FY2026` e não mude mais nada.”

Primeiro, use `query` para revisar os elementos afetados; em seguida, execute um `replaceText` literal e valide antes de exportar.

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

A consulta de revisão limita a alteração às ocorrências conhecidas; `replaceText` executa a mutação em massa aprovada, mantendo intactos os objetos não relacionados.

### 2. Renomear uma empresa ou produto

**Solicitação:** “Substitua o nome antigo do produto pelo novo nome em todos os lugares.”

Este é o mesmo padrão seguro de revisar e substituir. Primeiro, pesquise o nome antigo exato; depois, use `replaceText` com um valor literal. Para variações como pontuação ou espaçamento, use uma substituição por expressão regular somente após verificar a saída da consulta.

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

Para uma alteração mais restrita, inclua um seletor no comando, por exemplo, `"selector": "slide=256"`, para que somente um slide possa ser afetado.

### 3. Extrair um esboço de apresentação para um agente

**Solicitação:** “Liste os títulos dos slides e resuma o que esta apresentação aborda.”

Execute `inspect` para recuperar a estrutura indexada da apresentação e, depois, consulte objetos que contenham texto. O agente que chama o Deckuse pode agrupar os objetos retornados por ID de slide, identificar objetos semelhantes a títulos por seus nomes, posições ou texto e gerar um resumo a partir do texto extraído.

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

O Deckuse fornece os dados-fonte estruturados. O agente, e não o Deckuse, é responsável por decidir qual texto é um título e por redigir o resumo.

### 4. Executar QA de conteúdo antes da entrega

**Solicitação:** “Encontre nomes antigos de clientes, datas, nomes de produtos, URLs e o texto obrigatório de aviso legal antes de enviar esta apresentação.”

Consulte cada risco conhecido e inspecione as referências retornadas. As verificações de ausência funcionam da mesma forma: consulte o texto obrigatório e sinalize um resultado vazio. Um agente pode gerar um relatório de QA sem modificar a apresentação ou preparar comandos `setText` / `replaceText` estritamente direcionados para correções aprovadas.

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

Trata-se de QA de conteúdo e estrutura, e não de QA visual. O Deckuse não renderiza slides nem determina se o texto se sobrepõe a outro conteúdo.

### 5. Alterar exatamente um item em um slide

**Solicitação:** “No slide 7, altere o título para `Enterprise Strategy`; não altere mais nada.”

Primeiro, consulte esse slide e o texto do título; depois, use o `ref` retornado para enviar um comando `setText`. O `ref` evita uma substituição global ambígua.

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

Os IDs de elemento são exemplos específicos de uma apresentação. Sempre use um ID retornado pelo espaço de trabalho atual, em vez de copiar este valor.

### 6. Padronizar a tipografia dos títulos

**Solicitação:** “Defina todos os títulos aprovados como 28 pt e use a família tipográfica aprovada.”

Use uma consulta para identificar os objetos de título, faça o agente revisar ou filtrar as referências retornadas e aplique `setProperties` uma vez para cada referência aprovada. `setProperties` tem como alvo uma referência por vez; ele não aceita um seletor diretamente.

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

O mesmo comando pode definir `fill`, `stroke` (também `border`, `outline` ou `line`), `textColor`, `italic`, `underline`, `name` e `hidden`. Chaves de propriedade desconhecidas falham com `INVALID_COMMAND`.

### 7. Ajustar com precisão a geometria de um objeto

**Solicitação:** “Mova cada título aprovado um pouco mais para baixo.”

Consulte e selecione as referências dos títulos pretendidos, inspecione a geometria atual deles e emita um comando `setTransform` por objeto com coordenadas explícitas. Esta é uma operação estrutural de geometria; não a apresente como correção automática de layout sem validação visual.

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

As coordenadas de transformação são EMUs do OOXML. Preserve `x`, `width` e `height` do objeto inspecionado quando alterar apenas sua posição vertical.

### 8. Personalizar uma apresentação de vendas aprovada

**Solicitação:** “Crie uma versão para um cliente em potencial. Atualize o nome do cliente e o texto aprovado específico da conta, mas preserve o design.”

Crie um espaço de trabalho separado para cada saída a partir do modelo mestre aprovado. Consulte os placeholders ou o texto existente do cliente, aplique apenas as substituições revisadas, valide e faça commit em um arquivo distinto.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Aplicar somente as substituições revisadas para este cliente.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
deckuse commit ./customer-a -o customer-a-deck.pptx --json
```

Espaços de trabalho separados impedem que as edições de um cliente vazem para a saída de outro. Substitua apenas os objetos que o processo de aprovação permite que o agente modifique.

### 9. Produzir variantes regionais ou para públicos diferentes a partir de um único modelo mestre

**Solicitação:** “Gere variantes regionais e empresariais a partir da apresentação aprovada.”

Inicialize um novo espaço de trabalho a partir do mesmo modelo mestre para cada variante. Cada variante recebe seu próprio arquivo de comandos e caminho de saída. Use `batch` quando as alterações de uma variante precisarem ser atômicas: se um comando falhar, nenhuma alteração do lote será persistida.

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

Isso preserva uma única apresentação-fonte aprovada e, ao mesmo tempo, torna cada variante reproduzível a partir de um conjunto explícito de alterações.

### 10. Permitir que um agente de código opere uma apresentação existente

**Solicitação:** “Inspecione esta apresentação, identifique as edições solicitadas, realize-as e exporte um PPTX revisado.”

Forneça ao agente este ciclo: inicializar um espaço de trabalho, inspecionar ou consultar antes de cada alteração direcionada, gerar comandos JSON explícitos, aplicá-los, validar o pacote e fazer commit de uma nova saída. Armazene o arquivo de comandos e os resultados dos comandos junto com a tarefa quando a auditabilidade for importante.

O Deckuse fornece ao agente referências estáveis, seletores, transações, validação e um caminho de exportação determinístico. O agente fornece a interpretação da tarefa e decide quais operações são adequadas.

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
