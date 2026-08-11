<div align="center">

# Deckuse

[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse — локальный, управляемый схемами движок автоматизации документов Office для кодовых агентов. Он открывает документ в версионированном рабочем пространстве, позволяет агенту исследовать и точно выбирать структуру, применять явные JSON-команды, проверять результат и экспортировать новый документ.

Сейчас реализован формат PPTX. Адаптеры DOCX, XLSX, Keynote и Numbers намеренно возвращают `FORMAT_NOT_IMPLEMENTED`; пока они не поддерживаются как цели редактирования.

## Зачем нужен Deckuse

Deckuse позволяет изменять существующую презентацию, не создавая её заново. Рабочий процесс намеренно ориентирован на структуру, а не на визуальное представление:

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → commit → updated.pptx
```

По возможности сохраняются неизменённые XML и неизвестные части пакета. Это не движок рендеринга: он не может надёжно оценить привлекательность слайда или правильность макета.

## Установка

Требования: Node.js 24 или новее и pnpm 10.

```sh
pnpm install
pnpm install:global
```

Вторая команда глобально устанавливает локальный CLI `deckuse`. При разработке репозитория запустите её повторно после пересборки CLI.

```sh
pnpm build
pnpm install:global
```

```sh
# Создать постоянное рабочее пространство из презентации.
deckuse init input.pptx ./workspace --json

# Проверить индексированный документ и найти целевые элементы.
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# Применить одну JSON-команду, JSON-массив или JSONL.
deckuse apply ./workspace --input operations.jsonl --json

# Проверить пакет и экспортировать.
deckuse validate ./workspace --json
deckuse commit ./workspace -o output.pptx --json
```

## Рабочий процесс CLI

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command.

Результаты команд записываются в стандартный вывод в JSON; ошибки недопустимых аргументов или ввода — в стандартный поток ошибок. Код `0` означает успех, `1` — сбой команды, `2` — ошибку использования или разбора CLI.

### Селекторы

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

## Типовые сценарии для агентов

В этих примерах используются только текущие возможности PPTX. Они описывают рабочие процессы, которые агент может составить из примитивов Deckuse, но не утверждают, что Deckuse самостоятельно выполняет рассуждения, пишет тексты или проводит визуальную проверку.

### 1. Обновить устаревший год во всей презентации

**Запрос:** «Измени каждое упоминание `FY2025` на `FY2026`, не меняя ничего другого».

Сначала используйте `query`, чтобы проверить затронутые элементы, затем выполните буквальный `replaceText` и проверьте результат перед экспортом.

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

Проверочный запрос ограничивает изменение известными вхождениями; `replaceText` выполняет утверждённое массовое изменение, не затрагивая посторонние объекты.

### 2. Переименовать компанию или продукт

**Запрос:** «Заменить старое название продукта на новое во всей презентации».

Это тот же безопасный шаблон «проверить и заменить». Сначала найдите точное старое название, затем используйте `replaceText` с буквальным значением. Для вариантов с иной пунктуацией или пробелами применяйте замену по регулярному выражению только после проверки вывода `query`.

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

Для более узкого изменения включите в команду селектор, например `"selector": "slide=256"`, чтобы подходил только один слайд.

### 3. Извлечь структуру презентации для агента

**Запрос:** «Перечисли заголовки слайдов и кратко опиши, чему посвящена эта презентация».

Запустите `inspect`, чтобы получить индексированную структуру презентации, затем запросите объекты с текстом. Вызывающий агент может сгруппировать возвращённые объекты по ID слайдов, определить объекты, похожие на заголовки, по их именам, позициям или тексту и составить сводку на основе извлечённого текста.

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse предоставляет структурированные исходные данные. Решать, какой текст является заголовком, и писать сводку должен агент, а не Deckuse.

### 4. Провести контентный QA перед отправкой

**Запрос:** «Перед отправкой презентации найди старые имена клиентов, даты, названия продуктов, URL и обязательный текст отказа от ответственности».

Выполните запрос для каждого известного риска и проверьте возвращённые ссылки. Проверка отсутствия работает так же: запросите обязательный текст и отметьте пустой результат. Агент может подготовить отчёт QA, не изменяя презентацию, либо подготовить узко нацеленные команды `setText` / `replaceText` для утверждённых исправлений.

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

Это QA содержимого и структуры, а не визуальный QA. Deckuse не визуализирует слайды и не определяет, перекрывает ли текст другое содержимое.

### 5. Изменить ровно один элемент на одном слайде

**Запрос:** «На слайде 7 измени заголовок на `Enterprise Strategy`; ничего другого не меняй».

Сначала запросите этот слайд и текст заголовка, затем возьмите возвращённый `ref` и отправьте команду `setText`. `ref` предотвращает неоднозначную глобальную замену.

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

ID элементов в примере зависят от конкретной презентации. Всегда используйте ID, возвращённый текущим рабочим пространством, а не копируйте это значение.

### 6. Стандартизировать типографику заголовков

**Запрос:** «Сделай каждый утверждённый заголовок размером 28 pt и задай утверждённый шрифт».

Используйте запрос для поиска объектов-заголовков, поручите агенту проверить или отфильтровать возвращённые ссылки и применяйте `setProperties` по одному разу для каждой утверждённой ссылки. `setProperties` нацелен на одну ссылку за раз; сам по себе он не принимает селектор.

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

Та же команда может задавать `fill`, `stroke` (также `border`, `outline` или `line`), `textColor`, `italic`, `underline`, `name` и `hidden`. Неизвестные ключи свойств завершаются ошибкой `INVALID_COMMAND`.

### 7. Точно скорректировать геометрию объекта

**Запрос:** «Сдвинь каждый утверждённый заголовок немного ниже».

Запросите и выберите нужные ссылки на заголовки, изучите их текущую геометрию и отправьте по одной команде `setTransform` на объект с явными координатами. Это структурная операция с геометрией; не следует выдавать её за автоматическое исправление макета без визуальной проверки.

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

Координаты transform — это EMU стандарта OOXML. При изменении только вертикального положения сохраняйте `x`, `width` и `height` из проверенного объекта.

### 8. Персонализировать утверждённую коммерческую презентацию

**Запрос:** «Создай версию для потенциального клиента. Обнови имя клиента и утверждённый текст для его аккаунта, но сохрани дизайн».

Создавайте отдельное рабочее пространство для каждого результата на основе утверждённого исходника. Запросите заполнители или существующий текст клиента, применяйте только проверенные замены, выполните валидацию и зафиксируйте результат в отдельном файле.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Apply reviewed replacements for this customer only.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
deckuse commit ./customer-a -o customer-a-deck.pptx --json
```

Отдельные рабочие пространства не позволяют изменениям одного клиента попасть в результат другого. Заменяйте только объекты, которые процесс согласования разрешает агенту изменять.

### 9. Создать региональные или аудиторные варианты из одного исходника

**Запрос:** «Сгенерируй региональный и корпоративный варианты утверждённой презентации».

Инициализируйте новое рабочее пространство из одного исходника для каждого варианта. Для каждого варианта нужны собственные файл команд и путь вывода. Используйте `batch`, когда изменения варианта должны быть атомарными: если одна команда не выполнится, ни одно изменение из пакета не сохранится.

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

Так сохраняется один утверждённый исходный файл, а каждый вариант становится воспроизводимым на основе явного набора изменений.

### 10. Дать coding-агенту управлять существующей презентацией

**Запрос:** «Проверь эту презентацию, определи требуемые изменения, внеси их и экспортируй пересмотренный PPTX».

Задайте агенту такой цикл: инициализировать рабочее пространство, выполнять `inspect` или `query` перед каждым целевым изменением, генерировать явные JSON-команды, применять их, валидировать пакет и фиксировать новый результат. Когда важна аудируемость, храните файл команд и результаты команд вместе с задачей.

Deckuse даёт агенту стабильные ссылки, селекторы, транзакции, валидацию и детерминированный путь экспорта. Агент интерпретирует задачу и решает, какие операции уместны.

### Пример `setProperties`

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

## Возможности PPTX

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

## Ограничения

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## Проверки разработки

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
