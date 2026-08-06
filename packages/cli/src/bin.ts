#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { runCommand } from './index.js';
const args = process.argv.slice(2);
const json = args.includes('--json');
const clean = args.filter((arg) => arg !== '--json');
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
  } else {
    const action = clean[0];
    let ok = true;
    if (action === 'init') {
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
    } else if (action === 'apply') {
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
    } else throw new Error(`Unknown command: ${action ?? '(missing)'}`);
    if (!ok) process.exitCode = 1;
  }
} catch (cause) {
  process.stderr.write(`deckuse: ${cause instanceof Error ? cause.message : 'Invalid input'}\n`);
  process.exitCode = 2;
}
