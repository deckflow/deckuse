# DeckUse Manual v2

**Generated:** 2026-03-29  
**Scope:** `man deckuse` draft, compact layout, Git-inspired workflow, no diff in phase 1.

# DECKUSE(1)
## NAME
**deckuse** — headless, file-native structural operations for PPTX decks

## SYNOPSIS
```bash
deckuse <command> [options]
```

## DESCRIPTION
DeckUse is a local-first structural editing engine for PPTX files. Phase 1 uses a Git-inspired workflow around a local unpacked working directory. A PPTX must first be unpacked with `deckuse init`; all write commands require an initialized workspace; some read commands can read a raw `.pptx` directly, while structural read/query commands require initialization. Phase 1 safety boundary:
- do not add, remove, or rewrite rel relationships by default
- do not add new media parts
- do not create or delete slides by default
- do not rewrite package topology except during init/build
- prefer edits to existing XML nodes, text runs, transforms, and style properties

## WORKFLOW
### `deckuse init`
Unpack a `.pptx` into a DeckUse workspace.
```bash
deckuse init company_deck.pptx
deckuse init company_deck.pptx --dir ./company_deck.deck
```
Behavior:
- unzips PPTX into a working directory
- builds indexes for slides, shapes, text, and selectors
- creates DeckUse metadata for command execution
- marks the workspace as editable

Typical layout:
```text
company_deck.deck/
  .deckuse/
  [Content_Types].xml
  _rels/
  docProps/
  ppt/
```

### `deckuse status`
Show workspace status.
```bash
deckuse status ./company_deck.deck
```
Outputs:
- initialized / not initialized
- source file if known
- workspace health
- whether workspace has unbuilt changes
- last validation status

### `deckuse commit`
Build the workspace back into a `.pptx`.
```bash
deckuse commit ./company_deck.deck
deckuse commit ./company_deck.deck --output out.pptx
```
Behavior:
- validates workspace structure
- rebuilds ZIP package
- emits a PPTX file
- does not imply Git-style diff/history in phase 1

### `deckuse validate`
Validate workspace or PPTX package.
```bash
deckuse validate company_deck.pptx
deckuse validate ./company_deck.deck
```

### `deckuse doctor`
Run heuristic checks against a workspace or PPTX package.
```bash
deckuse doctor company_deck.pptx
deckuse doctor ./company_deck.deck
```

## INPUT MODES
### Direct PPTX mode
Allowed for:
- `inspect`
- `validate`
- `doctor`
- limited top-level metadata reads

Example:
```bash
deckuse inspect company_deck.pptx
```

### Workspace mode
Required for:
- structural read commands such as `list`, `show`, `tree`, `get`, `find`, `query`, `stats`
- all write commands
- all S2 commands

Example:
```bash
deckuse init company_deck.pptx
deckuse list slides ./company_deck.deck
deckuse set text ./company_deck.deck "slide:3/title" "2026 Strategy"
deckuse commit ./company_deck.deck --output company_deck_out.pptx
```

## SELECTOR SYNTAX

Selectors are the core addressing mechanism in DeckUse. They allow you to target specific slides, shapes, text, or layouts within a presentation.

### Selector Types

#### 1. Index-based Selectors
Select elements by their position (1-based indexing):

```bash
slide:1        # First slide
slide:3        # Third slide
shape:2        # Second shape (context-dependent)
layout:1       # First layout
```

#### 2. Path-based Selectors
Navigate to nested elements using `/` separator:

```bash
slide:1/title           # Title element in slide 1
slide:3/body            # Body element in slide 3
slide:2/footer          # Footer element in slide 2
```

**Note**: Path names depend on the slide layout structure. Common paths include `title`, `body`, `subtitle`, `footer`.

#### 3. Filter-based Selectors
Select elements matching specific criteria using `[filter]` syntax:

**Key-Value Filters**:
```bash
shape[type=textbox]     # All textbox shapes
shape[type=picture]     # All picture shapes
slide[layout=Title]     # All slides using Title layout
layout[path=ppt/slideLayouts/slideLayout1.xml]  # Layout by path
```

**Function-style Filters**:
```bash
text[contains('Revenue')]       # Text containing "Revenue"
text[contains('2026')]          # Text containing "2026"
shape[contains('Chart')]        # Shapes containing "Chart" in name/text
```

#### 4. Type-only Selectors
Select all elements of a type:

```bash
slide          # All slides
shape          # All shapes (context-dependent)
text           # All text elements
layout         # All layouts
```

### Selector Grammar

```ebnf
selector        ::= type_selector | index_selector | filter_selector | path_selector

type_selector   ::= "slide" | "shape" | "text" | "layout"

index_selector  ::= type ":" number
                  # Examples: slide:1, shape:3, layout:2

filter_selector ::= type "[" filter "]"
                  # Examples: shape[type=textbox], text[contains('keyword')]

path_selector   ::= index_selector "/" path_component ("/" path_component)*
                  # Examples: slide:1/title, slide:3/body/text

type           ::= "slide" | "shape" | "text" | "layout"
number         ::= [1-9][0-9]*
filter         ::= key_value_filter | function_filter
key_value_filter ::= identifier "=" value
function_filter  ::= identifier "(" value ")"
identifier     ::= [a-zA-Z_][a-zA-Z0-9_]*
path_component ::= [a-zA-Z0-9_-]+
value          ::= [^)\]]+ | "'" [^']* "'" | '"' [^"]* '"'
```

### Usage Examples

#### Reading Content
```bash
# Get text from slide 3's title
deckuse get text workspace "slide:3/title"

# Get all text from slide 1
deckuse get text workspace "slide:1"

# Find all text containing "Revenue"
deckuse get text workspace "text[contains('Revenue')]"
```

#### Modifying Content
```bash
# Set text in slide 1's title
deckuse set text workspace "slide:1/title" "New Title"

# Replace text in all slides
deckuse replace text workspace "2025" "2026"

# Set font size for all textboxes
deckuse set font-size workspace "shape[type=textbox]" 16
```

#### Querying Structure
```bash
# Show slide 2 details
deckuse show slide workspace 2

# List all slides
deckuse list slides workspace

# Query selector matches
deckuse query workspace "slide[layout=Title]"
```

### Selector Resolution

Selectors are resolved against the workspace's `results` structure from `@deckflow/presentation`:

1. **Index selectors**: Direct array access (1-based)
   - `slide:3` → `results.slides[2]`

2. **Path selectors**: Navigate nested structure
   - `slide:3/title` → Find title element in slide 3's shape tree

3. **Filter selectors**: Iterate and match
   - `shape[type=textbox]` → Filter all shapes by type
   - `text[contains('X')]` → Search text content

4. **Type selectors**: Return all of type
   - `slide` → All slides
   - `layout` → All layouts

### Current Limitations (Phase 1)

- Path navigation is basic (placeholder paths)
- Complex filter expressions not yet supported
- No boolean operators (AND, OR, NOT)
- No regex in filters (planned for Phase 2)
- Shape selection outside slide context limited

### Future Enhancements (Phase 2+)

- Regex support: `text[matches('^Q[1-4]$')]`
- Boolean operators: `shape[type=textbox AND contains('Revenue')]`
- Relative selectors: `slide:current/next`, `shape:previous`
- XPath-like syntax: `//shape[@type='textbox']`
- Range selectors: `slide:1-5`, `shape:2,4,6`
- Negative filters: `slide[layout!=Title]`

# PART I — READ COMMANDS
Read commands never modify content. Commands marked **[workspace]** require `deckuse init`.

## `deckuse inspect`
Print a deck-level summary.
```bash
deckuse inspect <file.pptx>
deckuse inspect <workspace.dir>
```
Returns:
- slide count
- per-slide shape counts
- notes/images/charts/tables presence
- layouts and masters in use
- font/color summary
- possible anomalies

## `deckuse status`
Show workspace state.
```bash
deckuse status <workspace.dir>
```

## `deckuse list` **[workspace]**
List structural entities.
```bash
deckuse list slides <workspace.dir>
deckuse list layouts <workspace.dir>
deckuse list masters <workspace.dir>
deckuse list themes <workspace.dir>
deckuse list shapes <workspace.dir> --slide 3
```
Returns:
- slides: index, slide id, inferred title, layout, shape count, notes presence
- layouts: layout id, name, slides using it
- masters: master ids, names, associated layouts
- themes: theme part, color set, font scheme
- shapes: shape id, name, type, x/y/w/h, z-order, text preview

## `deckuse show` **[workspace]**
Show structured details for a slide or shape.
```bash
deckuse show slide <workspace.dir> <slide>
deckuse show shape <workspace.dir> <selector>
```
Outputs:
- slide: layout, title, shape summary, image summary, text summary, style summary
- shape: object identity, type, geometry, fill/line/text style, text, image crop/transform

## `deckuse tree` **[workspace]**
Print the object tree for a slide.
```bash
deckuse tree slide <workspace.dir> <slide>
```

## `deckuse get` **[workspace]**
Read object properties.
```bash
deckuse get text <workspace.dir> <selector>
deckuse get runs <workspace.dir> <selector>
deckuse get paragraphs <workspace.dir> <selector>
deckuse get style <workspace.dir> <selector>
deckuse get fill <workspace.dir> <selector>
deckuse get line <workspace.dir> <selector>
deckuse get image-props <workspace.dir> <selector>
deckuse get bbox <workspace.dir> <selector>
```
Returns:
- `text`: plain text
- `runs`: paragraph/run breakdown with run-level style
- `paragraphs`: alignment, indent, bullets, spacing
- `style`: consolidated style summary
- `fill`: fill type and color
- `line`: stroke color, width, dash
- `image-props`: embed id, frame box, crop, rotation, flip
- `bbox`: geometry

## `deckuse find` **[workspace]**
Search content and structure.
```bash
deckuse find text <workspace.dir> "Revenue"
deckuse find shapes <workspace.dir> --type picture
deckuse find styles <workspace.dir> --font Aptos
deckuse find styles <workspace.dir> --color "#4472C4"
```

## `deckuse query` **[workspace]**
Resolve a selector expression.
```bash
deckuse query <workspace.dir> "slide[3].shape[type=textbox]"
deckuse query <workspace.dir> "text[contains('Revenue')]"
```

## `deckuse stats` **[workspace]**
Compute deck-wide statistics.
```bash
deckuse stats <workspace.dir>
```
Returns:
- font frequency
- color frequency
- text box count
- image count
- shape type distribution
- total text size

## `deckuse validate`
Validate workspace or PPTX package.
```bash
deckuse validate <file.pptx>
deckuse validate <workspace.dir>
```

## `deckuse doctor`
Run heuristic checks.
```bash
deckuse doctor <file.pptx>
deckuse doctor <workspace.dir>
```
Flags:
- empty text boxes
- tiny fonts
- overlap risk
- out-of-bounds objects
- heavy theme overrides

# PART II — S0 AND S1 WRITE COMMANDS
All write commands require a workspace created by `deckuse init`. They operate only on unpacked content and are materialized into a final `.pptx` with `deckuse commit`.

# S0 COMMANDS
S0 commands are highly safe, in-place edits to existing text, paragraph formatting, and geometry.

## `deckuse set text`
Replace text in an existing text object.
```bash
deckuse set text <workspace.dir> <selector> "2026 Strategy"
```

## `deckuse clear text`
Clear text from an existing text object.
```bash
deckuse clear text <workspace.dir> <selector>
```

## `deckuse replace text`
Replace matching text in a workspace, slide, or selection.
```bash
deckuse replace text <workspace.dir> "2025" "2026"
deckuse replace text <workspace.dir> --slide 5 "旧品牌" "新品牌"
deckuse replace text <workspace.dir> --regex "\bQ([1-4])\b" "Quarter \1"
```

## `deckuse set run-text`
Modify text in a specific run.
```bash
deckuse set run-text <workspace.dir> <selector> --p 0 --r 2 "Updated"
```

## `deckuse set font-family`
```bash
deckuse set font-family <workspace.dir> <selector> "Aptos"
```

## `deckuse set font-size`
```bash
deckuse set font-size <workspace.dir> <selector> 20
```

## `deckuse set font-color`
```bash
deckuse set font-color <workspace.dir> <selector> "#1F4E79"
```

## `deckuse set bold`
```bash
deckuse set bold <workspace.dir> <selector> on|off
```

## `deckuse set italic`
```bash
deckuse set italic <workspace.dir> <selector> on|off
```

## `deckuse set underline`
```bash
deckuse set underline <workspace.dir> <selector> on|off
```

## `deckuse set paragraph-align`
```bash
deckuse set paragraph-align <workspace.dir> <selector> left|center|right|justify
```

## `deckuse set bullet`
```bash
deckuse set bullet <workspace.dir> <selector> on|off
```

## `deckuse set indent`
```bash
deckuse set indent <workspace.dir> <selector> <value>
```

## `deckuse set line-spacing`
```bash
deckuse set line-spacing <workspace.dir> <selector> <value>
```

## `deckuse move`
Move an existing shape by delta.
```bash
deckuse move <workspace.dir> <selector> --dx <x> --dy <y>
```

## `deckuse set position`
Set absolute position for an existing shape.
```bash
deckuse set position <workspace.dir> <selector> --x <x> --y <y>
```

## `deckuse resize`
Resize an existing shape.
```bash
deckuse resize <workspace.dir> <selector> --w <w> --h <h>
```

## `deckuse rotate`
Rotate an existing shape.
```bash
deckuse rotate <workspace.dir> <selector> <deg>
```

## `deckuse flip`
Flip an existing shape.
```bash
deckuse flip <workspace.dir> <selector> horizontal|vertical
```

# S1 COMMANDS
S1 commands still avoid rel changes but are more sensitive to rendering, layout, and style details.

## `deckuse set fill-color`
```bash
deckuse set fill-color <workspace.dir> <selector> "#D9EAF7"
```

## `deckuse set fill-transparency`
```bash
deckuse set fill-transparency <workspace.dir> <selector> <value>
```

## `deckuse set line-color`
```bash
deckuse set line-color <workspace.dir> <selector> "#5B9BD5"
```

## `deckuse set line-width`
```bash
deckuse set line-width <workspace.dir> <selector> <value>
```

## `deckuse set line-dash`
```bash
deckuse set line-dash <workspace.dir> <selector> <style>
```

## `deckuse set hidden`
```bash
deckuse set hidden <workspace.dir> <selector> on|off
```

## `deckuse bring-forward`
```bash
deckuse bring-forward <workspace.dir> <selector>
```

## `deckuse send-backward`
```bash
deckuse send-backward <workspace.dir> <selector>
```

## `deckuse bring-to-front`
```bash
deckuse bring-to-front <workspace.dir> <selector>
```

## `deckuse send-to-back`
```bash
deckuse send-to-back <workspace.dir> <selector>
```

## `deckuse crop`
Update crop values on an existing picture shape without replacing the underlying media part.
```bash
deckuse crop <workspace.dir> <selector> --left <v> --right <v> --top <v> --bottom <v>
```

## `deckuse set image-frame`
Update the displayed frame of an existing image.
```bash
deckuse set image-frame <workspace.dir> <selector> --x <x> --y <y> --w <w> --h <h>
```

## `deckuse set alt-text`
```bash
deckuse set alt-text <workspace.dir> <selector> "团队协作场景"
```

## `deckuse set notes`
Update notes text for a slide that already has a notes part.
```bash
deckuse set notes <workspace.dir> <slide> "Presenter notes"
```

# PART III — S2 COMMANDS (MANUAL CONFIRMATION REQUIRED)
S2 commands may theoretically avoid rel modifications, but can still affect compatibility, rendering consistency, or downstream editability. All S2 commands require:
- initialized workspace
- preflight validation
- explicit `--confirm`
- recommended backup before commit

## `deckuse delete shape`
Remove an existing shape from a slide tree.
```bash
deckuse delete shape <workspace.dir> <selector> --confirm
```
Risks:
- placeholder integrity
- layout expectations
- animation references
- future editability in PowerPoint

## `deckuse overwrite media`
Replace bytes in an existing media file without changing rel bindings.
```bash
deckuse overwrite media <workspace.dir> <selector> <new-file> --confirm
```
Risks:
- image format mismatch
- dimension mismatch
- decoder support differences
- compression issues

## `deckuse rewrite style`
Rewrite or normalize local style nodes for an existing object.
```bash
deckuse rewrite style <workspace.dir> <selector> --confirm
```
Risks:
- theme fallback behavior
- Office compatibility
- unexpected visual changes

## `deckuse normalize text-body`
Rewrite text body structure while preserving visible content.
```bash
deckuse normalize text-body <workspace.dir> <selector> --confirm
```
Risks:
- run segmentation changes
- paragraph default changes
- editing behavior in PowerPoint
- copy/paste fidelity

## `deckuse reset shape-properties`
Rebuild selected shape property nodes.
```bash
deckuse reset shape-properties <workspace.dir> <selector> --confirm
```
Risks:
- fallback defaults
- rendering changes in older Office versions
- style inheritance changes

## `deckuse remove local-overrides`
Remove local styling in favor of inherited defaults.
```bash
deckuse remove local-overrides <workspace.dir> <selector> --confirm
```
Risks:
- significant appearance changes depending on theme/layout inheritance

## `deckuse hard-fit-text`
Apply destructive text fitting or scaling changes.
```bash
deckuse hard-fit-text <workspace.dir> <selector> --confirm
```
Risks:
- unreadable text
- unexpected line breaks
- editor-specific rendering changes

## `deckuse flatten group-like-structure`
Rewrite nested transform/layout structure for existing objects.
```bash
deckuse flatten group-like-structure <workspace.dir> <selector> --confirm
```
Risks:
- coordinate system changes
- reduced editability
- rendering inconsistency

# SAFETY MODEL
- **Read**: no file changes
- **S0**: highly safe in-place edits to existing text, transforms, and simple formatting
- **S1**: still avoids rel changes, but may influence rendering, layout, or style detail
- **S2**: explicit human confirmation required; may avoid rel edits while still causing compatibility or rendering side effects

# RECOMMENDED DEFAULTS
For phase 1:
- enable `init`, `status`, `commit`, `inspect`, `validate`, `doctor`
- enable all S0 commands by default
- enable S1 commands with validation and preview
- gate all S2 commands behind confirmation and backup guidance
- do not expose diff/history yet

# EXAMPLE HELP INDEX
```text
Core:
  init
  status
  commit
  inspect
  validate
  doctor

Read (workspace):
  list slides|layouts|masters|themes|shapes
  show slide|shape
  tree slide
  get text|runs|paragraphs|style|fill|line|image-props|bbox
  find text|shapes|styles
  query
  stats

S0:
  set text
  clear text
  replace text
  set run-text
  set font-family
  set font-size
  set font-color
  set bold
  set italic
  set underline
  set paragraph-align
  set bullet
  set indent
  set line-spacing
  move
  set position
  resize
  rotate
  flip

S1:
  set fill-color
  set fill-transparency
  set line-color
  set line-width
  set line-dash
  set hidden
  bring-forward
  send-backward
  bring-to-front
  send-to-back
  crop
  set image-frame
  set alt-text
  set notes

S2:
  delete shape
  overwrite media
  rewrite style
  normalize text-body
  reset shape-properties
  remove local-overrides
  hard-fit-text
  flatten group-like-structure
```

# QUICKSTART
```bash
deckuse init company_deck.pptx --dir ./company_deck.deck
deckuse status ./company_deck.deck
deckuse list slides ./company_deck.deck
deckuse set text ./company_deck.deck "slide:3/title" "2026 Strategy"
deckuse validate ./company_deck.deck
deckuse commit ./company_deck.deck --output company_deck_out.pptx
```
