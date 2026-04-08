# DeckUse

Headless engine for structural editing of PPTX files.

---

🌤️ Want to skip local setup? Use our cloud processing via https://deckflow.com

# 🤖 LLM Quickstart

1. Point your coding agent (Cursor, Claude Code, etc.) to DeckUse docs
2. Start issuing commands like:
   - “replace all 2025 with 2026”
   - “extract all titles”
   - “move image on slide 3”

---

# 👋 Human Quickstart

**1. Install DeckUse**

```bash
npm install -g @deckflow/deckuse
```

**2. Initialize a workspace**

```bash
deckuse init company.pptx --dir ./company.deck
```

**3. Inspect structure**

```bash
deckuse list slides ./company.deck
deckuse show slide ./company.deck 3
```

**Note**: Path names depend on the slide layout structure. Common paths include `title`, `body`, `subtitle`, `footer`.

#### 2.1. Shape ID Path Selectors (for nested/grouped shapes)
Some write operations (e.g. via `pptx-modifier`) address shapes by an **ID path**: if a shape with `id=9` is nested under a parent shape `id=6`, its ID path is `6,9`.

DeckUse supports expressing this in two equivalent forms:

- **Recommended (explicit, composable)**:

```bash
deckuse get text <workspace.dir> "slide:1/shape[id=6]/shape[id=9]"
```

- **CLI shorthand (ID path sugar)**:

```bash
deckuse get text <workspace.dir> "slide:1/#6,9"
```

Both selectors mean: within slide 1, traverse the shape tree by IDs `6 → 9`.

#### 3. Filter-based Selectors
Select elements matching specific criteria using `[filter]` syntax:

**Key-Value Filters**:
```bash
shape[type=textbox]     # All textbox shapes
shape[type=picture]     # All picture shapes
slide[layout=Title]     # All slides using Title layout
layout[path=ppt/slideLayouts/slideLayout1.xml]  # Layout by path
```

```bash
deckuse set text ./company.deck "slide:3/title" "2026 Strategy"
```

**Write commands and `-o/--output`**

- If `<workspace>` is a **workspace directory** (e.g. `./company.deck`), write commands will **modify the workspace only**. `-o` is **optional** and will export a PPTX if provided.
- If `<workspace>` is a **.pptx file path**, write commands require `-o` and will export the modified PPTX to that path (no `init` needed).

**5. Build PPTX**

```bash
deckuse commit ./company.deck --output output.pptx
```

---

# Demos

### ✏️ Text Replacement
Task = “Replace all 2025 with 2026”

```bash
deckuse replace ./deck "2025" "2026"
deckuse commit ./deck -o output.pptx
```

Or directly on a PPTX (no init, requires `-o`):

```bash
deckuse replace ./file.pptx "2025" "2026" -o output.pptx
```

---

### 📊 Structure Inspection
Task = “List all slides and titles”

```bash
deckuse list slides ./deck
```

---

### 🧩 Layout Adjustment
Task = “Move title on slide 3”

```bash
deckuse move ./deck "slide:3/title" --dx 100 --dy 0
```

---

# 💻 CLI

```bash
deckuse init file.pptx
deckuse status ./deck
deckuse list slides ./deck
deckuse set text ./deck "slide:1/title" "Hello"
deckuse commit ./deck
```

---

## Concepts

- **Workspace** — unpacked PPTX directory
- **Selector** — query language for slides/shapes
- **Command model** — read / edit
- **Commit** — rebuild PPTX

---

## FAQ

<details>
<summary><b>Why use DeckUse instead of editing PPTX directly?</b></summary>

PPTX files are complex OOXML packages. DeckUse provides safe, structured editing without breaking relationships.
</details>

<details>
<summary><b>Do I need to use init?</b></summary>

Yes for all modifications. Some commands can work directly on PPTX.
</details>

<details>
<summary><b>Is DeckUse free?</b></summary>

Yes, DeckUse is open source.
</details>

<details>
<summary><b>Does DeckUse render slides?</b></summary>

No. Use DeckOps Project for rendering and conversion.
</details>

---

<div align="center">

**Tell your deck what to do, and it updates itself.**

</div>
