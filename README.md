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

**4. Modify content**

```bash
deckuse set text ./company.deck "slide:3/title" "2026 Strategy"
```

**5. Build PPTX**

```bash
deckuse commit ./company.deck --output output.pptx
```

---

# Demos

### ✏️ Text Replacement
Task = “Replace all 2025 with 2026”

```bash
deckuse replace text ./deck "2025" "2026"
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
