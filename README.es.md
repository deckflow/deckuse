<div align="center">

# Deckuse

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse es un motor local-first, basado en esquemas, para automatizar documentos Office mediante agentes de programación. Abre un documento en un espacio de trabajo versionado, permite al agente inspeccionar y seleccionar su estructura, aplica comandos JSON explícitos, valida el resultado y exporta un documento nuevo.

PPTX es el formato implementado actualmente. Los adaptadores de DOCX, XLSX, Keynote y Numbers devuelven deliberadamente `FORMAT_NOT_IMPLEMENTED`; aún no son destinos de edición compatibles.

## Por qué Deckuse

Deckuse permite modificar una presentación existente sin recrearla desde cero. Su flujo de trabajo prioriza deliberadamente la estructura sobre lo visual:

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → commit → updated.pptx
```

Conserva el XML intacto y las partes desconocidas del paquete siempre que es posible. No es un motor de renderizado y no puede juzgar de forma fiable si una diapositiva es atractiva o si el diseño visual es correcto.

## Instalación

Requisitos: Node.js 18 o posterior.

```sh
npm install -g @deckflow/deckuse
```

Este comando instala globalmente la CLI `deckuse`.

```sh
# Crear un espacio de trabajo persistente desde una presentación.
deckuse init input.pptx ./workspace --json

# Inspeccionar el documento indexado y consultar elementos objetivo.
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# Aplicar un comando JSON, una matriz JSON o JSONL.
deckuse apply ./workspace --input operations.jsonl --json

# Validar el paquete y exportar.
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
```

## Flujo de trabajo de la CLI

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command.

Los resultados se escriben como JSON en la salida estándar; los errores por argumentos o entradas no válidos se escriben en la salida de error. El estado `0` indica éxito, `1` error de comando y `2` error de uso o análisis de la CLI.

### Selectores

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

## Flujos de trabajo habituales de agentes

Estos ejemplos utilizan únicamente las capacidades actuales de PPTX. Describen flujos de trabajo que un agente puede componer a partir de primitivas de Deckuse, sin afirmar que Deckuse realice de forma independiente razonamiento, redacción de textos ni revisión visual.

### 1. Actualizar un año desactualizado en toda una presentación

**Solicitud:** «Cambia cada referencia a `FY2025` por `FY2026` y no modifiques nada más».

Primero usa `query` para revisar los elementos afectados; después realiza un `replaceText` literal y valida antes de exportar.

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

La consulta de revisión limita el cambio a las apariciones conocidas; `replaceText` realiza la modificación masiva aprobada y deja intactos los objetos no relacionados.

### 2. Renombrar una empresa o un producto

**Solicitud:** «Sustituye el nombre antiguo del producto por el nuevo en todas partes».

Es el mismo patrón seguro de revisar y sustituir. Busca primero el nombre antiguo exacto y luego usa `replaceText` con un valor literal. Para variaciones como puntuación o espaciado, utiliza una sustitución mediante expresión regular solo después de revisar el resultado de `query`.

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

Para un cambio más restringido, incluye un selector en el comando, por ejemplo, `"selector": "slide=256"`, de modo que solo una diapositiva sea elegible.

### 3. Extraer un esquema de presentación para un agente

**Solicitud:** «Enumera los títulos de las diapositivas y resume de qué trata esta presentación».

Ejecuta `inspect` para recuperar la estructura indexada de la presentación y luego consulta los objetos que contienen texto. El agente invocador puede agrupar los objetos devueltos por ID de diapositiva, identificar objetos semejantes a títulos por sus nombres, posiciones o texto, y generar un resumen a partir del texto extraído.

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse proporciona los datos fuente estructurados. El agente, y no Deckuse, es responsable de decidir qué texto es un título y de redactar el resumen.

### 4. Ejecutar QA de contenido antes de la entrega

**Solicitud:** «Antes de enviar esta presentación, busca nombres de clientes antiguos, fechas, nombres de productos, URL y el texto obligatorio de descargo de responsabilidad».

Consulta cada riesgo conocido e inspecciona las referencias devueltas. Las comprobaciones de ausencia funcionan igual: consulta el texto obligatorio y marca un resultado vacío. Un agente puede generar un informe de QA sin modificar la presentación, o preparar comandos `setText` / `replaceText` dirigidos de forma precisa para correcciones aprobadas.

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

Esto es QA de contenido y estructura, no QA visual. Deckuse no renderiza diapositivas ni determina si un texto se superpone con otro contenido.

### 5. Cambiar exactamente un elemento en una diapositiva

**Solicitud:** «En la diapositiva 7, cambia el título a `Enterprise Strategy`; no cambies nada más».

Primero consulta esa diapositiva y el texto del título; después toma el `ref` devuelto y envía un comando `setText`. El `ref` evita una sustitución global ambigua.

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

Los ID de elemento son ejemplos específicos de una presentación. Usa siempre un ID devuelto por el espacio de trabajo actual en lugar de copiar este valor.

### 6. Estandarizar la tipografía de los títulos

**Solicitud:** «Establece todos los títulos aprobados en 28 pt y usa la tipografía aprobada».

Usa una consulta para identificar objetos de título, haz que el agente revise o filtre las referencias devueltas y aplica `setProperties` una vez por cada referencia aprobada. `setProperties` se dirige a una referencia cada vez; no acepta un selector por sí mismo.

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

El mismo comando puede establecer `fill`, `stroke` (también `border`, `outline` o `line`), `textColor`, `italic`, `underline`, `name` y `hidden`. Las claves de propiedad desconocidas fallan con `INVALID_COMMAND`.

### 7. Ajustar con precisión la geometría de un objeto

**Solicitud:** «Desplaza ligeramente hacia abajo todos los títulos aprobados».

Consulta y selecciona las referencias de título previstas, inspecciona su geometría actual y emite un comando `setTransform` por objeto con coordenadas explícitas. Se trata de una operación estructural de geometría; no la presentes como corrección automática del diseño sin validación visual.

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

Las coordenadas de transformación son EMU de OOXML. Conserva `x`, `width` y `height` del objeto inspeccionado si solo cambias su posición vertical.

### 8. Personalizar una presentación comercial aprobada

**Solicitud:** «Crea una versión para un cliente potencial. Actualiza el nombre del cliente y el texto aprobado específico de la cuenta, pero conserva el diseño».

Crea un espacio de trabajo independiente para cada salida a partir del original aprobado. Consulta los marcadores de posición o el texto actual del cliente, aplica únicamente sustituciones revisadas, valida y confirma en un archivo distinto.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Apply reviewed replacements for this customer only.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
deckuse commit ./customer-a -o customer-a-deck.pptx --json
```

Los espacios de trabajo independientes evitan que las modificaciones de un cliente se filtren a la salida de otro. Sustituye únicamente los objetos cuya modificación el proceso de aprobación permite al agente.

### 9. Producir variantes regionales o para distintas audiencias desde un original

**Solicitud:** «Genera variantes regionales y empresariales a partir de la presentación aprobada».

Inicializa un espacio de trabajo nuevo desde el mismo original para cada variante. Cada variante recibe su propio archivo de comandos y ruta de salida. Usa `batch` cuando los cambios de una variante deban ser atómicos: si falla un comando, no se conserva ninguno de los cambios del lote.

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

Esto conserva una única presentación fuente aprobada y hace que cada variante sea reproducible a partir de un conjunto de cambios explícito.

### 10. Permitir que un agente de programación opere una presentación existente

**Solicitud:** «Inspecciona esta presentación, identifica las modificaciones solicitadas, realízalas y exporta un PPTX revisado».

Proporciona al agente este ciclo: inicializar un espacio de trabajo, inspeccionar o consultar antes de cada cambio dirigido, generar comandos JSON explícitos, aplicarlos, validar el paquete y confirmar una salida nueva. Cuando la auditabilidad sea importante, guarda el archivo de comandos y los resultados de los comandos junto con la tarea.

Deckuse proporciona al agente referencias estables, selectores, transacciones, validación y una ruta de exportación determinista. El agente aporta la interpretación de la tarea y decide qué operaciones son adecuadas.

### Ejemplo de `setProperties`

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

## Capacidades de PPTX

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

## Limitaciones

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## Comprobaciones de desarrollo

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
