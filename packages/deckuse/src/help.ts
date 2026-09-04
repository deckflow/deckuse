import { PROTOCOL_VERSION } from '@deckflow/deckuse-core';

const GLOBAL_OPTIONS = `Global options:
  --workspace <path>        Explicit workspace (default: nearest .deckuse)
  --revision <rev>          Read a historical revision (writes reject it)
  --json                    Machine-readable envelope
  --quiet                   Suppress human-oriented summaries
  --dry-run                 Plan a write without committing
  --expect-revision <rev>   Optimistic-concurrency guard for writes
  --reason <text>           Stored with write history`;

const WRITE_GLOBALS = `Write globals: --workspace, --json, --dry-run, --expect-revision, --reason`;

export const HELP_MAIN = `usage: deckuse [global-options] <command> [subcommand] [target] [options]

DeckUse Phase 1a CLI (protocol ${PROTOCOL_VERSION}).

${GLOBAL_OPTIONS}

Commands:
  init          Create a workspace from a .pptx
  status        Show workspace revision / branch summary
  list          List slides, shapes, layouts, masters, or theme
  get           Read a target's properties (with provenance)
  inspect       Deck/slide structural diagnostic
  search        Search text or shapes
  add           Add a slide or shape
  remove        Remove a slide or shape target
  set           Set text or dotted properties on a target
  replace-text  Find/replace text across the deck
  xfrm          Set geometry (x/y/width/height/rotation)
  z             Change z-order
  apply         Apply JSON / JSONL write commands
  validate      Validate package / relationships
  history       Show write history
  undo          Undo recent write revisions
  export        Pack workspace to .pptx
  monitor       Live HTML preview server
  render        Screenshot one slide to PNG (for visual review)

Run 'deckuse <command> --help' for details.
`;

type HelpEntry = {
  usage: string;
  summary: string;
  example: string;
  details?: string;
};

const entries: Record<string, HelpEntry> = {
  init: {
    usage: 'deckuse init <input.pptx> <workspace/>',
    summary: 'Unpack a PPTX into a versioned DeckUse workspace (revision starts at 1).',
    example: 'deckuse init input.pptx ./workspace --json',
    details: `Arguments:
  <input.pptx>              Source presentation to unpack
  <workspace/>              Destination directory for the workspace

Options:
  --json                    Machine-readable envelope

Notes:
  Creates source/, package.pptx, .deckuse/, and a Git baseline.
  Does not normalize or rewrite slide content.`,
  },

  status: {
    usage: 'deckuse status [--workspace <path>]',
    summary: 'Show workspace revision, branch, and package summary.',
    example: 'deckuse status --workspace ./workspace --json',
    details: `Options:
  --workspace <path>        Workspace root (default: nearest .deckuse)
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  list: {
    usage: 'deckuse list <slides|shapes|layouts|masters|theme> [options]',
    summary: 'List inventory resources from the workspace index / live package.',
    example: 'deckuse list shapes --slide 1 --workspace ./workspace --json',
    details: `Arguments:
  slides | shapes | layouts | masters | theme

Options:
  --slide <n>               Required for shapes; one-based slide index
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope

Examples:
  deckuse list slides --json
  deckuse list shapes --slide 12 --json
  deckuse list layouts --json`,
  },

  'list slides': {
    usage: 'deckuse list slides [options]',
    summary: 'List slides with index, uid, title preview, layout, and notes flags.',
    example: 'deckuse list slides --workspace ./workspace --json',
    details: `Options:
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  'list shapes': {
    usage: 'deckuse list shapes --slide <n> [options]',
    summary: 'List shapes on a slide (id, name, role, type, bbox, text preview).',
    example: 'deckuse list shapes --slide 1 --workspace ./workspace --json',
    details: `Required:
  --slide <n>               One-based slide index

Options:
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  'list layouts': {
    usage: 'deckuse list layouts [options]',
    summary: 'List slide layouts available in the package.',
    example: 'deckuse list layouts --json',
    details: `Options:
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  'list masters': {
    usage: 'deckuse list masters [options]',
    summary: 'List slide masters available in the package.',
    example: 'deckuse list masters --json',
    details: `Options:
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  'list theme': {
    usage: 'deckuse list theme [options]',
    summary: 'List theme tokens / theme inventory.',
    example: 'deckuse list theme --json',
    details: `Options:
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  get: {
    usage: 'deckuse get <target> [options]',
    summary: 'Read a semantic target with direct/effective values and provenance.',
    example: 'deckuse get slide:1/shape:2 --resolve both --json',
    details: `Arguments:
  <target>                  e.g. slide:1, slide:1/shape:2, slide:1/shape:2/text

Options:
  --resolve <mode>          effective | direct | both (default: both)
  --props <a,b,c>           Comma-separated property filter
  --no-provenance           Omit inheritance source paths
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  inspect: {
    usage: 'deckuse inspect [<target>] [options]',
    summary: 'Structural diagnostic for the deck or a slide/target.',
    example: 'deckuse inspect slide:1 --visual-tree --depth 2 --json',
    details: `Arguments:
  <target>                  Optional; omit for presentation-level inspect

Options:
  --visual-tree             Include object tree projection
  --depth <n>               Tree depth (default: 2)
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  search: {
    usage: 'deckuse search <text|shape> ...',
    summary: 'Search indexed text or shapes; never mutates the workspace.',
    example: 'deckuse search text "Q2 Revenue" --limit 50 --json',
    details: `Subcommands:
  text <query>              Literal text search
  shape                     Shape search via --name / --query

Options:
  --name <name>             Match shape name
  --query <text>            Query string (shape mode)
  --limit <n>               Max results (default: 100)
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope

Run 'deckuse search <text|shape> --help' for details.`,
  },

  'search text': {
    usage: 'deckuse search text <query> [options]',
    summary: 'Search slide text for a literal query string.',
    example: 'deckuse search text "FY2025" --limit 100 --json',
    details: `Arguments:
  <query>                   Literal text to find

Options:
  --limit <n>               Max results (default: 100)
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  'search shape': {
    usage: 'deckuse search shape [options]',
    summary: 'Search shapes by name and/or query string.',
    example: 'deckuse search shape --name "Title" --limit 50 --json',
    details: `Options:
  --name <name>             Match shape name
  --query <text>            Additional query string
  --limit <n>               Max results (default: 100)
  --workspace <path>        Workspace root
  --revision <rev>          Read a historical revision
  --json                    Machine-readable envelope`,
  },

  add: {
    usage: 'deckuse add <slide|shape> [options]',
    summary: 'Add a slide or shape. One successful write commits one revision.',
    example:
      'deckuse add shape --slide 1 --type text --name Title --x 0 --y 0 --width 914400 --height 457200',
    details: `Subcommands:
  slide                     Insert a new slide
  shape                     Insert a shape on an existing slide

${WRITE_GLOBALS}

Run 'deckuse add <slide|shape> --help' for details.`,
  },

  'add slide': {
    usage: 'deckuse add slide [options]',
    summary: 'Insert one slide (and package/relationship updates) in a single revision.',
    example: 'deckuse add slide --after 5 --layout title-and-content --name feature-page --json',
    details: `Options:
  --after <n>               Insert after one-based slide index (append if omitted)
  --layout <name-or-id>     Layout to use (blank / title-and-content / ...)
  --name <name>             Slide name stored in inventory
  ${WRITE_GLOBALS}`,
  },

  'add shape': {
    usage: 'deckuse add shape --slide <n> --type <kind> [options]',
    summary:
      'Insert a shape on a slide. Geometry uses EMU integers (1 CSS px @ 96 DPI = 9525 EMU).',
    example:
      'deckuse add shape --slide 1 --type text --name Title --role title --x 0 --y 0 --width 914400 --height 457200 --json',
    details: `Required:
  --slide <n>               One-based slide index
  --type <kind>             text | rect | rounded-rect | ellipse | line | image | group

Options:
  --name <name>             Shape name (should be unique on the slide)
  --role <role>             Semantic role (title, body, card, image, ...)
  --x <emu>                 X position in EMU
  --y <emu>                 Y position in EMU
  --width <emu>             Width in EMU
  --height <emu>            Height in EMU
  --file <path>             Image source path (required for --type image)
  ${WRITE_GLOBALS}`,
  },

  remove: {
    usage: 'deckuse remove <target> [options]',
    summary: 'Remove a slide or shape target in one revision.',
    example: 'deckuse remove slide:1/shape:2 --reason "obsolete bullet" --json',
    details: `Arguments:
  <target>                  e.g. slide:9 or slide:6/shape:17

Options:
  ${WRITE_GLOBALS}`,
  },

  set: {
    usage: 'deckuse set text <target> --value <text> | deckuse set <target> --prop value ...',
    summary: 'Write text or dotted semantic properties on exactly one target.',
    example: "deckuse set slide:1/shape:2 --font.size 42 --fill.color '#0A2930' --json",
    details: `Forms:
  set text <target> --value <text>
  set <target> --font.size 42 --fill.color '#RRGGBB' ...

Common properties:
  font.family, font.size, font.weight, font.color, font.italic
  fill.kind, fill.color, fill.transparency
  line.kind, line.color, line.width, line.dash
  paragraph.align, text-box.auto-fit, name, visible
  x, y, width, height, rotation

Options:
  --scope <scope>           local (default) | placeholder | layout | master | theme
  --value <text>            Required for set text
  ${WRITE_GLOBALS}

Run 'deckuse set text --help' for the text form.`,
  },

  'set text': {
    usage: 'deckuse set text <target> --value <text> [options]',
    summary: 'Replace the full text body of a target. Does not search across the deck.',
    example: "deckuse set text slide:1/shape:2 --value 'Hello' --json",
    details: `Arguments:
  <target>                  e.g. slide:1/shape:2 or slide:1/shape:2/text

Required:
  --value <text>            Replacement text (use $'...' for newlines in shells)

Options:
  ${WRITE_GLOBALS}`,
  },

  'replace-text': {
    usage:
      'deckuse replace-text --source <text> --target <text> [--regex] [--limit <n>] [--selector <sel>]',
    summary: 'Find and replace text across matching indexed text nodes.',
    example:
      'deckuse replace-text --source FY2025 --target FY2026 --json',
    details: `Required:
  --source <text>           Find string (non-empty); maps to protocol find
  --target <text>           Replacement string; maps to protocol replace

Options:
  --regex                   Treat --source as a Unicode regular expression
  --limit <n>               Max replacements
  --selector <sel>          Narrow matches (e.g. slide=1)
  ${WRITE_GLOBALS}`,
  },

  xfrm: {
    usage: 'deckuse xfrm set (--target <t> | --slide <n> --shape <id>) [geometry]',
    summary: 'Low-level geometry write. All supplied fields apply atomically.',
    example:
      'deckuse xfrm set --slide 1 --shape 2 --x 0 --y 0 --width 914400 --height 457200 --json',
    details: `Subcommands:
  set                       Set transform fields on one shape

Options (via set):
  --target <target>         e.g. slide:1/shape:2
  --slide <n> --shape <id>  Alternative addressing
  --x <emu> --y <emu>
  --width|--cx <emu>
  --height|--cy <emu>
  --rotation <deg>          Clockwise degrees
  ${WRITE_GLOBALS}

Run 'deckuse xfrm set --help' for details.`,
  },

  'xfrm set': {
    usage: 'deckuse xfrm set (--target <t> | --slide <n> --shape <id>) [geometry]',
    summary: 'Set x/y/width/height/rotation on one shape in EMU / degrees.',
    example:
      'deckuse xfrm set --target slide:1/shape:2 --x 914400 --y 1371600 --width 6858000 --height 1371600',
    details: `Addressing (one required):
  --target <target>         e.g. slide:1/shape:2
  --slide <n> --shape <id>  Combined into slide:<n>/shape:<id>

Geometry (all optional; supplied fields applied together):
  --x <emu>                 X position
  --y <emu>                 Y position
  --width <emu>             Width (--cx alias)
  --height <emu>            Height (--cy alias)
  --rotation <deg>          Clockwise rotation

Options:
  ${WRITE_GLOBALS}`,
  },

  z: {
    usage: 'deckuse z move <target> (--above <t> | --below <t> | --to-front | --to-back)',
    summary: 'Change relative z-order of a shape.',
    example: 'deckuse z move slide:1/shape:6 --above slide:1/shape:2 --json',
    details: `Subcommands:
  move                      Reorder one target relative to another

Options (via move):
  --above <target>          Place above another target
  --below <target>          Place below another target
  --to-front                Bring to front
  --to-back                 Send to back
  ${WRITE_GLOBALS}

Run 'deckuse z move --help' for details.`,
  },

  'z move': {
    usage: 'deckuse z move <target> (--above <t> | --below <t> | --to-front | --to-back)',
    summary: 'Move a shape above/below another target, or to front/back.',
    example: 'deckuse z move slide:1/shape:7 --to-front --json',
    details: `Arguments:
  <target>                  Shape to move, e.g. slide:1/shape:6

Position (choose one):
  --above <target>          Place immediately above
  --below <target>          Place immediately below
  --to-front                Bring to front of the slide
  --to-back                 Send to back of the slide

Options:
  ${WRITE_GLOBALS}`,
  },

  apply: {
    usage: 'deckuse apply [<workspace>] [--input <file|->]',
    summary:
      'Apply write commands from JSON / JSONL / transaction { "operations": [...] }.',
    example: 'deckuse apply --workspace ./workspace --input ops.json --json',
    details: `Arguments:
  <workspace>               Optional workspace path (or use --workspace)

Options:
  --input <file|->          Input path; "-" (default) reads stdin
  ${WRITE_GLOBALS}

Accepted input shapes:
  { "operations": [ ... ] } Transaction ops
  [ { "type": "setText", ... }, ... ]
  { "type": "setText", ... } Single command
  JSONL                     One command object per line

Only write command types are accepted.`,
  },

  validate: {
    usage: 'deckuse validate [<workspace>] [options]',
    summary: 'Validate package integrity and optional relationship checks.',
    example: 'deckuse validate --workspace ./workspace --package --relationships --json',
    details: `Arguments:
  <workspace>               Optional workspace path (or use --workspace)

Options:
  --level <level>           Validation level (default: full)
  --package                 Include package checks
  --relationships           Include relationship graph checks
  --slide <n>               Limit to one slide when supported
  --workspace <path>        Workspace root
  --revision <rev>          Validate a historical revision
  --json                    Machine-readable envelope`,
  },

  history: {
    usage: 'deckuse history [<workspace>] [options]',
    summary: 'List committed write operations from the workspace journal.',
    example: 'deckuse history --workspace ./workspace --limit 20 --json',
    details: `Arguments:
  <workspace>               Optional workspace path (or use --workspace)

Options:
  --limit <n>               Max entries (default: 100)
  --offset <n>              Skip entries (default: 0)
  --slide <n>               Filter to operations affecting a slide
  --workspace <path>        Workspace root
  --json                    Machine-readable envelope`,
  },

  undo: {
    usage: 'deckuse undo [<workspace>] [--steps <n>]',
    summary: 'Undo one or more recent write revisions.',
    example: 'deckuse undo --workspace ./workspace --steps 1 --json',
    details: `Arguments:
  <workspace>               Optional workspace path (or use --workspace)

Options:
  --steps <n>               Number of revisions to undo (default: 1)
  ${WRITE_GLOBALS}`,
  },

  export: {
    usage: 'deckuse export <output.pptx> [options]',
    summary: 'Pack the workspace (or a historical revision) into a .pptx file.',
    example: 'deckuse export ./out.pptx --workspace ./workspace --json',
    details: `Arguments:
  <output.pptx>             Destination path

Options:
  --workspace <path>        Workspace root
  --revision <rev>          Export a historical revision
  --json                    Machine-readable envelope`,
  },

  monitor: {
    usage: 'deckuse monitor [<workspace>] [--host <addr>] [--port <n>]',
    summary: 'Start a live HTML preview server for the workspace.',
    example: 'deckuse monitor --workspace ./workspace --port 4173',
    details: `Arguments:
  <workspace>               Optional workspace path (or use --workspace)

Options:
  --host <addr>             Bind address (default: 0.0.0.0)
  --port <n>                Port 0–65535 (default: 4173)
  --workspace <path>        Workspace root

Notes:
  Blocks until SIGINT/SIGTERM. Browser subscribers drive render updates.`,
  },

  render: {
    usage: 'deckuse render --page <n> [--output <file.png>]',
    summary:
      'Convert one slide to HTML (office2html), screenshot it with Playwright, then delete the HTML staging output.',
    example: 'deckuse render --page 3 --workspace ./workspace --json',
    details: `Required:
  --page <n>                One-based slide index (exactly one page per call)

Options:
  --output <file.png>       PNG path (default: .deckuse/render/page-<n>.png)
  --workspace <path>        Workspace root (default: nearest .deckuse)
  --json                    Machine-readable envelope

Notes:
  Intended for AI agents to visually review whether an edit looks correct.
  Requires a system Chrome / Chromium / Edge, or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
  Temporary office2html output is always removed after the screenshot.`,
  },

  query: {
    usage: 'deckuse query [<workspace>] <selector> [--limit <n>]',
    summary: 'Back-compat selector query (prefer search / list for Phase 1a).',
    example: "deckuse query ./workspace 'text=FY2025' --limit 100 --json",
    details: `Arguments:
  <workspace>               Optional workspace path when not using --workspace
  <selector>                Selector string (default: *)

Options:
  --limit <n>               Max results (default: 100)
  --workspace <path>        Workspace root
  --json                    Machine-readable envelope

Selector examples:
  * | all
  kind=textbox
  text=Quarter
  text~=pattern
  hasText=true
  slide=1 name=Title`,
  },
};

const formatEntry = (entry: HelpEntry): string => {
  const parts = [`usage: ${entry.usage}`, '', entry.summary, '', `Example:`, `  ${entry.example}`];
  if (entry.details) {
    parts.push('', entry.details);
  }
  parts.push('');
  return parts.join('\n');
};

/** Resolve progressive help for a command path such as ['add','shape']. */
export const resolveHelp = (topic: string[]): string => {
  if (topic.length === 0) return HELP_MAIN;

  const key = topic.map((part) => part.toLowerCase()).join(' ');
  const entry = entries[key];
  if (entry) return formatEntry(entry);

  if (topic.length > 1) {
    const parentKey = topic[0]!.toLowerCase();
    const parent = entries[parentKey];
    if (parent) {
      return (
        `Unknown subcommand: ${topic.slice(1).join(' ')}\n\n` +
        formatEntry(parent) +
        `Run 'deckuse ${parentKey} --help' for available forms.\n`
      );
    }
  }

  return (
    `Unknown command: ${topic[0]}\n\n` +
    HELP_MAIN +
    `Run 'deckuse --help' for the command list.\n`
  );
};

/** Tokens that form a help topic (command path), ignoring options and help flags. */
export const helpTopicFromArgs = (clean: string[]): string[] | null => {
  if (clean.length === 0) return null;

  if (clean[0] === 'help') {
    return clean.slice(1).filter((token) => token !== '--help' && token !== '-h' && !token.startsWith('--'));
  }

  const helpIndex = clean.findIndex((token) => token === '--help' || token === '-h');
  if (helpIndex < 0) return null;

  return clean.slice(0, helpIndex).filter((token) => !token.startsWith('--'));
};
