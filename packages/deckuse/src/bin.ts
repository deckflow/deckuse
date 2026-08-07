#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { runCommand } from './index.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const clean = args.filter((arg) => arg !== '--json');
const version = '0.0.0';

type HelpCommand = 'init' | 'inspect' | 'query' | 'apply' | 'validate' | 'commit';

const HELP: Record<'main' | HelpCommand, string> = {
  main: `usage: deckuse <command> [<args>] [--json]

Inspect, modify, validate, and export Office document workspaces.

Common commands:
  init <input> <workspace>       Create a workspace from an Office document
  inspect <workspace>            Inspect the document structure
  query <workspace> [selector]   Query document elements
  apply <workspace>              Apply JSON command objects
  validate <workspace>           Validate workspace changes
  commit <workspace>             Export the workspace to a document

Run 'deckuse <command> --help' for details about a command.
Run 'deckuse help <command>' for the same command reference.

Options:
  -h, --help       Show this help message
  -v, -V, --version
                   Show the deckuse version
  --json           Format command results as compact JSON
`,
  init: `usage: deckuse init <input> <workspace> [--json]

Create a deckuse workspace from an Office document.

Arguments:
  <input>          Source document (.pptx, .docx, .xlsx, .key, or .numbers)
  <workspace>      Directory in which to create the workspace

Example:
  deckuse init presentation.pptx ./presentation
`,
  inspect: `usage: deckuse inspect <workspace> [--depth <n>] [--json]

Inspect the indexed structure of a workspace.

Arguments:
  <workspace>      Existing deckuse workspace

Options:
  --depth <n>      Traversal depth (default: 2)

Example:
  deckuse inspect ./presentation --depth 3
`,
  query: `usage: deckuse query <workspace> [selector] [--limit <n>] [--json]

Query indexed elements in a workspace.

Arguments:
  <workspace>      Existing deckuse workspace
  [selector]       Element selector (default: *)

Options:
  --limit <n>      Maximum results to return (default: 100)

Example:
  deckuse query ./presentation 'slide[*] text' --limit 20
`,
  apply: `usage: deckuse apply <workspace> [--input <file|->] [--json]

Apply one or more JSON command objects to a workspace. Input may be a JSON
object, a JSON array, or newline-delimited JSON. Commands read from standard
input by default.

Arguments:
  <workspace>      Existing deckuse workspace

Options:
  --input <file|-> Command input file, or - for standard input (default: -)

Examples:
  deckuse apply ./presentation --input changes.json
  printf '%s\n' '{"type":"add", ...}' | deckuse apply ./presentation
`,
  validate: `usage: deckuse validate <workspace> [--level <level>] [--json]

Validate workspace changes before export.

Arguments:
  <workspace>      Existing deckuse workspace

Options:
  --level <level>  Validation level (default: full)

Example:
  deckuse validate ./presentation --level full
`,
  commit: `usage: deckuse commit <workspace> [-o <output>] [--force] [--json]

Export workspace changes to an Office document.

Arguments:
  <workspace>      Existing deckuse workspace

Options:
  -o, --output <output>
                   Destination document path
  -f, --force      Overwrite an existing destination

Example:
  deckuse commit ./presentation -o updated.pptx
`,
};

const writeHelp = (command: keyof typeof HELP = 'main'): void => {
  process.stdout.write(HELP[command]);
};

const isHelpFlag = (value: string | undefined): boolean => value === '--help' || value === '-h';
const isVersionFlag = (value: string | undefined): boolean =>
  value === '--version' || value === '-v' || value === '-V';
const isHelpCommand = (value: string): value is HelpCommand => value in HELP && value !== 'main';

const readStdin = async (): Promise<string> => {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
};
const option = (name: string): string | undefined => {
  const i = clean.indexOf(name);
  return i >= 0 ? clean[i + 1] : undefined;
};
const output = (result: unknown): void => {
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
};
const execute = async (command: unknown): Promise<boolean> => {
  const result = await runCommand(command);
  output(result);
  return result.ok;
};
const revisionFor = async (workspace: string): Promise<string> => {
  const manifest = JSON.parse(
    await readFile(resolve(workspace, '.deckuse', 'manifest.json'), 'utf8'),
  ) as { revision: string };
  return manifest.revision;
};

try {
  if (clean.length === 0) {
    const payload = await readStdin();
    const ok = await execute(JSON.parse(payload));
    if (!ok) process.exitCode = 1;
  } else if (isHelpFlag(clean[0])) {
    writeHelp();
  } else if (isVersionFlag(clean[0])) {
    process.stdout.write(`deckuse ${version}\n`);
  } else if (clean[0] === 'help') {
    const command = clean[1];
    if (!command) writeHelp();
    else if (isHelpCommand(command)) writeHelp(command);
    else throw new Error(`Unknown command: ${command}`);
  } else {
    const action = clean[0];
    let ok = true;
    if (!action || !isHelpCommand(action))
      throw new Error(`Unknown command: ${action ?? '(missing)'}`);
    if (isHelpFlag(clean[1])) {
      writeHelp(action);
    } else if (action === 'init') {
      const source = clean[1],
        workspace = clean[2];
      if (!source || !workspace) throw new Error('Usage: deckuse init input.pptx workspace/');
      ok = await execute({
        version: '1.0',
        type: 'init',
        workspaceId: workspace,
        format: extname(source).slice(1).toLowerCase(),
        source,
      });
    } else if (action === 'inspect' || action === 'query' || action === 'validate') {
      const workspace = clean[1];
      if (!workspace) throw new Error(`Usage: deckuse ${action} workspace/`);
      ok = await execute(
        action === 'query'
          ? {
              version: '1.0',
              type: 'query',
              workspaceId: workspace,
              selector: clean[2] ?? '*',
              limit: Number(option('--limit') ?? 100),
            }
          : {
              version: '1.0',
              type: action,
              workspaceId: workspace,
              ...(action === 'inspect'
                ? { depth: Number(option('--depth') ?? 2) }
                : { level: option('--level') ?? 'full' }),
            },
      );
    } else if (action === 'commit') {
      const workspace = clean[1];
      if (!workspace) throw new Error('Usage: deckuse commit workspace/ -o output.pptx [--force]');
      const force = clean.includes('--force') || clean.includes('-f');
      ok = await execute({
        version: '1.0',
        type: 'commit',
        workspaceId: workspace,
        transactionId: await revisionFor(workspace),
        ...(option('-o') || option('--output')
          ? { destination: option('-o') ?? option('--output') }
          : {}),
        ...(force ? { overwrite: true } : {}),
      });
    } else {
      const workspace = clean[1],
        input = option('--input') ?? '-';
      if (!workspace) throw new Error('Usage: deckuse apply workspace/ --input file|-');
      const raw = input === '-' ? await readStdin() : await readFile(resolve(input), 'utf8');
      let values: unknown[];
      try {
        const parsed = JSON.parse(raw) as unknown;
        values = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        values = raw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown);
      }
      for (const value of values) {
        if (typeof value !== 'object' || value === null)
          throw new Error('apply input must contain command objects');
        const command = {
          version: '1.0',
          workspaceId: workspace,
          transactionId: await revisionFor(workspace),
          ...(value as Record<string, unknown>),
        };
        ok = (await execute(command)) && ok;
        if (!ok) break;
      }
    }
    if (!ok) process.exitCode = 1;
  }
} catch (cause) {
  process.stderr.write(`deckuse: ${cause instanceof Error ? cause.message : 'Invalid input'}\n`);
  process.exitCode = 2;
}
