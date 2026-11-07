#!/usr/bin/env node
import { recoverPptxExport } from './pptx/export-recovery.js';
import { converterPreflight } from './deck2html-exec.js';
import { agentContext } from './agent-context.js';
import { REVIEW_WRITES } from './review/schema.js';
import { requireDefined } from './required.js';
import { access, open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import {
  PROTOCOL_VERSION,
  commandJsonSchema,
  measureText,
  parseLength,
  revisionAsNumber,
  type CommandEnvelope,
  type Diagnostic,
  type Result,
} from './core/index.js';
import { resolveCliText } from './cli-text.js';
import { assertDefaultDocxExists, assertDefaultPptxExists } from './default-template.js';
import { helpTopicFromArgs, resolveHelp } from './help.js';
import { runCommand } from './index.js';
import {
  monitorStart,
  monitorStatus,
  monitorStatusAll,
  monitorStop,
  monitorStopAll,
  runMonitorForeground,
} from './monitor-daemon.js';
import { renderPage, renderPages, parsePageSelection } from './render.js';
import { browserPreflight, renderFailurePayload } from './render-browser.js';
import { EDITION } from './edition.js';
import { version } from './version.js';

const args = process.argv.slice(2);

const takeFlag = (list: string[], name: string): boolean => {
  const i = list.indexOf(name);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
};

const takeOption = (list: string[], name: string): string | undefined => {
  const i = list.indexOf(name);
  if (i < 0) return undefined;
  const value = list[i + 1];
  list.splice(i, 2);
  return value;
};

const json = takeFlag(args, '--json');
const quiet = takeFlag(args, '--quiet');
const dryRun = takeFlag(args, '--dry-run');
const workspaceOpt = takeOption(args, '--workspace');
const revisionOpt = takeOption(args, '--revision');
const expectRevisionOpt = takeOption(args, '--expect-revision');
const reasonOpt = takeOption(args, '--reason');
const clean = args;

const findWorkspace = async (start?: string): Promise<string> => {
  if (start) return resolve(start);
  let dir = resolve(process.cwd());
  for (;;) {
    try {
      await access(join(dir, '.deckuse', 'manifest.json'));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error('No deckuse workspace found; pass --workspace <path>');
      dir = parent;
    }
  }
};

const revisionFor = async (workspace: string): Promise<string> => {
  const manifest = JSON.parse(
    await readFile(resolve(workspace, '.deckuse', 'manifest.json'), 'utf8'),
  ) as { revision: string };
  return manifest.revision;
};

const readStdin = async (): Promise<string> => {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
};

const mutationExtras = async (workspace: string) => {
  const transactionId = expectRevisionOpt ?? (await revisionFor(workspace));
  return {
    version: PROTOCOL_VERSION,
    workspaceId: workspace,
    transactionId,
    ...(dryRun ? { dryRun: true } : {}),
    ...(expectRevisionOpt ? { expectRevision: expectRevisionOpt } : {}),
    ...(reasonOpt ? { reason: reasonOpt } : {}),
  };
};

const toEnvelope = (
  commandLabel: string,
  result: Result<unknown>,
  extras: Partial<CommandEnvelope> = {},
): CommandEnvelope => {
  if (!result.ok) {
    return {
      ok: false,
      command: commandLabel,
      warnings: result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message),
      error: {
        code: result.error.code,
        message: result.error.message,
        ...(result.error.target ? { target: result.error.target } : {}),
        ...(result.error.hint ? { hint: result.error.hint } : {}),
        ...(result.error.details ? { details: result.error.details } : {}),
        ...(result.error.diagnostics?.length
          ? { diagnostics: result.error.diagnostics }
          : result.diagnostics.length
            ? { diagnostics: result.diagnostics }
            : {}),
      },
      ...extras,
    };
  }
  const value = result.value as Record<string, unknown>;
  const revision =
    revisionAsNumber(value['revision'] as string | number | undefined) ??
    (typeof value['revision'] === 'number' ? value['revision'] : undefined);
  return {
    ok: true,
    command: commandLabel,
    ...(revision !== undefined ? { revision } : {}),
    branch: typeof value['branch'] === 'string' ? value['branch'] : 'main',
    ...(Array.isArray(value['affectedSlides'])
      ? { affectedSlides: value['affectedSlides'] as number[] }
      : {}),
    ...(Array.isArray(value['changedTargets'])
      ? { changedTargets: value['changedTargets'] as string[] }
      : {}),
    ...(Array.isArray(value['changedParts'])
      ? { changedParts: value['changedParts'] as string[] }
      : {}),
    warnings: [
      ...result.diagnostics.map((d) => d.message),
      ...(Array.isArray(value['warnings']) ? (value['warnings'] as string[]) : []),
      ...(Array.isArray(value['diagnostics'])
        ? (value['diagnostics'] as ({ message?: unknown } | null)[])
            .map((item) => (typeof item?.message === 'string' ? item.message : ''))
            .filter(Boolean)
        : []),
    ].filter((message, index, all) => all.indexOf(message) === index),
    data: value,
    ...extras,
  };
};

const outputEnvelope = (envelope: CommandEnvelope): void => {
  if (json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }
  if (quiet) return;
  if (!envelope.ok) {
    process.stderr.write(
      `deckuse: ${envelope.error?.code ?? 'ERROR'}: ${envelope.error?.message ?? 'failed'}\n`,
    );
    if (envelope.error?.hint) process.stderr.write(`hint: ${envelope.error.hint}\n`);
    const diagnostics = (envelope.error as { diagnostics?: Diagnostic[] } | undefined)?.diagnostics;
    if (Array.isArray(diagnostics)) {
      for (const d of diagnostics) {
        const path =
          Array.isArray(d.path) && d.path.length > 0 ? `${d.path.map(String).join('.')}: ` : '';
        process.stderr.write(`  - ${path}${d.message}\n`);
      }
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
};

const execute = async (commandLabel: string, command: unknown): Promise<boolean> => {
  if (revisionOpt && typeof command === 'object' && command !== null) {
    const type = (command as { type?: string }).type;
    if (
      type &&
      ![
        'status',
        'list',
        'get',
        'inspect',
        'search',
        'find',
        'query',
        'getText',
        'validate',
        'history',
        'export',
      ].includes(type)
    ) {
      outputEnvelope({
        ok: false,
        command: commandLabel,
        error: {
          code: 'INVALID_COMMAND',
          message: 'Write commands reject --revision; omit it or use a read command',
        },
      });
      return false;
    }
  }
  const result = await runCommand(command);
  outputEnvelope(toEnvelope(commandLabel, result));
  return result.ok;
};

const parseProps = (list: string[]): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  for (let i = 0; i < list.length;) {
    const token = requireDefined(list[i]);
    if (!token.startsWith('--')) {
      i += 1;
      continue;
    }
    const key = token.slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) {
      props[key] = true;
      i += 1;
      continue;
    }
    let value: unknown = next;
    if (next === 'true') value = true;
    else if (next === 'false') value = false;
    else if (/^-?\d+(\.\d+)?$/.test(next)) value = Number(next);
    else if (
      (next.startsWith('{') && next.endsWith('}')) ||
      (next.startsWith('[') && next.endsWith(']'))
    ) {
      try {
        value = JSON.parse(next) as unknown;
      } catch {
        value = next;
      }
    }
    props[key] = value;
    i += 2;
  }
  return props;
};

const optionFrom = (list: string[], name: string): string | undefined => {
  const i = list.indexOf(name);
  return i >= 0 ? list[i + 1] : undefined;
};

const flagValueIndexes = (list: string[]): Set<number> => {
  const flagValues = new Set<number>();
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (!token?.startsWith('--')) continue;
    const next = list[index + 1];
    if (next !== undefined && !next.startsWith('--')) flagValues.add(index + 1);
  }
  return flagValues;
};

/** First positional argument after the command, skipping `--flag value` pairs. */
const positionalArg = (list: string[]): string | undefined => {
  const flagValues = flagValueIndexes(list);
  return list.find(
    (token, index) => index > 0 && !token.startsWith('--') && !flagValues.has(index),
  );
};

/** Every positional argument after the command, skipping `--flag value` pairs. */
const positionalArgs = (list: string[]): string[] => {
  const flagValues = flagValueIndexes(list);
  return list.filter(
    (token, index) => index > 0 && !token.startsWith('--') && !flagValues.has(index),
  );
};

const canonicalPath = async (p: string): Promise<string> => {
  const resolved = resolve(p);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
};

const isDirectory = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
};

/** Pass through bare numbers as number; keep unit strings for protocol parseLength. */
const lengthArg = (raw: string | undefined): number | string | undefined => {
  if (raw === undefined) return undefined;
  if (raw === 'auto') return 'auto';
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
};

const APPLY_WRITE_TYPES = new Set([
  ...REVIEW_WRITES,
  'setText',
  'replaceText',
  'setTransform',
  'setProperties',
  'set',
  'setSlideLayout',
  'setTableLayout',
  'xfrmSet',
  'zMove',
  'add',
  'addSlide',
  'addShape',
  'addParagraph',
  'addTable',
  'insertBreak',
  'remove',
  'replacePicture',
  'duplicate',
  'alignElements',
  'batch',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTransactionOp = (value: unknown): boolean => isRecord(value) && 'op' in value;

const isHighLevelWrite = (value: unknown): boolean =>
  isRecord(value) && APPLY_WRITE_TYPES.has(String(value['type']));

/** Classify apply payload items: high-level batch vs low-level transaction. */
const classifyApplyOps = (
  ops: unknown[],
): { kind: 'batch' } | { kind: 'transaction' } | { kind: 'invalid'; message: string } => {
  if (ops.length === 0)
    return { kind: 'invalid', message: 'apply input operations array is empty' };
  if (ops.every(isTransactionOp)) return { kind: 'transaction' };
  if (ops.every(isHighLevelWrite)) return { kind: 'batch' };
  if (ops.some(isHighLevelWrite) && ops.some(isTransactionOp)) {
    return {
      kind: 'invalid',
      message:
        'apply input mixes high-level write commands (type) with transaction ops (op); use one format',
    };
  }
  if (ops.some(isHighLevelWrite)) return { kind: 'batch' };
  if (ops.some(isTransactionOp)) {
    return {
      kind: 'invalid',
      message:
        'apply transaction operations must all include "op"; high-level writes must use "type"',
    };
  }
  return {
    kind: 'invalid',
    message:
      'apply input must be high-level write commands ({ "type": "addShape"|... }) or transaction ops ({ "op": ... })',
  };
};

const main = async (): Promise<void> => {
  try {
    if (clean.length === 0) {
      const payload = await readStdin();
      const parsed = JSON.parse(payload) as unknown;
      const ok = await execute('stdin', parsed);
      if (!ok) process.exitCode = 1;
    } else if (clean[0] === '--version' || clean[0] === '-v' || clean[0] === '-V') {
      process.stdout.write(`deckuse ${version} (edition=${EDITION})\n`);
    } else {
      const helpTopic = helpTopicFromArgs(clean);
      if (helpTopic !== null) {
        process.stdout.write(resolveHelp(helpTopic));
        return;
      }

      const action = requireDefined(clean[0]);
      let ok = true;

      if (action === 'agent-context') {
        for (const flag of ['--format', '--scenario'])
          if (clean.includes(flag) && !optionFrom(clean, flag))
            throw new Error(flag + ' requires a value');
        outputEnvelope({
          ok: true,
          command: 'deckuse agent-context',
          data: await agentContext({
            ...(optionFrom(clean, '--format')
              ? { format: optionFrom(clean, '--format') ?? 'pptx' }
              : {}),
            ...(workspaceOpt ? { workspace: workspaceOpt } : {}),
            ...(optionFrom(clean, '--scenario')
              ? { scenario: optionFrom(clean, '--scenario') ?? 'create' }
              : {}),
            includeSchema: clean.includes('--include-schema'),
          }),
        });
        return;
      }
      if (action === 'schema') {
        if (clean.includes('--type') && !optionFrom(clean, '--type'))
          throw new Error('--type requires a command type');
        if (clean.includes('--list') && clean.includes('--type'))
          throw new Error('Choose --list or --type');
        if (clean.includes('--command'))
          throw new Error('Use schema --type addShape instead of --command add');
        const typeOpt =
          optionFrom(clean, '--type') ??
          (clean[1] && !clean[1].startsWith('--') ? clean[1] : undefined);
        const full = commandJsonSchema as {
          oneOf?: unknown[];
          anyOf?: unknown[];
          $defs?: Record<string, unknown>;
        };
        const defs = full.$defs ?? {};
        const resolveRef = (entry: unknown): Record<string, unknown> | undefined => {
          if (!entry || typeof entry !== 'object') return undefined;
          const record = entry as Record<string, unknown>;
          if (typeof record['$ref'] === 'string') {
            const ref = record['$ref'];
            const name = ref.replace(/^#\/\$defs\//, '');
            const resolved = defs[name];
            return resolved && typeof resolved === 'object'
              ? (resolved as Record<string, unknown>)
              : undefined;
          }
          return record;
        };
        const typeOf = (entry: unknown): string | undefined => {
          const resolved = resolveRef(entry);
          const typeProp = resolved?.['properties']
            ? (resolved['properties'] as Record<string, unknown>)['type']
            : undefined;
          if (!typeProp || typeof typeProp !== 'object') return undefined;
          const typeRecord = typeProp as Record<string, unknown>;
          if (typeof typeRecord['const'] === 'string') return typeRecord['const'];
          const nested = resolveRef(typeProp);
          return typeof nested?.['const'] === 'string' ? nested['const'] : undefined;
        };
        const types = (full.oneOf ?? full.anyOf ?? [])
          .map(typeOf)
          .filter((x): x is string => Boolean(x));
        if (clean.includes('--list')) {
          outputEnvelope({
            ok: true,
            command: 'deckuse schema',
            data: {
              cliVersion: version,
              protocolVersion: PROTOCOL_VERSION,
              edition: EDITION,
              types,
              batchTypes: types.filter((type) => APPLY_WRITE_TYPES.has(type)),
            },
          });
          return;
        }
        let schema: unknown = full;
        if (typeOpt) {
          const variants = full.oneOf ?? full.anyOf ?? [];
          const match = variants.find((entry) => typeOf(entry) === typeOpt);
          if (!match) {
            const known = variants.map(typeOf).filter(Boolean).join(', ');
            throw new Error(
              `Unknown command type for schema: ${typeOpt}. Known: ${known || '(none)'}`,
            );
          }
          const root = resolveRef(match) ?? match;
          const reachable: Record<string, unknown> = {};
          const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
              value.forEach(visit);
              return;
            }
            const record = value as Record<string, unknown>;
            if (typeof record['$ref'] === 'string' && record['$ref'].startsWith('#/$defs/')) {
              const key = record['$ref'].slice(8);
              if (!(key in reachable) && key in defs) {
                reachable[key] = defs[key];
                visit(defs[key]);
              }
            }
            Object.values(record).forEach(visit);
          };
          visit(root);
          schema = { ...root, $defs: reachable };
        }
        const payload = {
          ok: true,
          command: 'deckuse schema',
          data: {
            cliVersion: version,
            protocolVersion: PROTOCOL_VERSION,
            edition: EDITION,
            ...(typeOpt ? { type: typeOpt } : {}),
            schema,
          },
        };
        process.stdout.write(`${JSON.stringify(payload, null, json ? undefined : 2)}\n`);
        return;
      }

      if (action === 'measure') {
        const text = optionFrom(clean, '--text');
        if (text === undefined)
          throw new Error('Usage: deckuse measure --text <string> --font-size <pt>');
        const fontSize = Number(
          optionFrom(clean, '--font-size') ?? optionFrom(clean, '--fontSize') ?? 12,
        );
        if (!(fontSize > 0)) throw new Error('--font-size must be a positive number (pt)');
        const bold = clean.includes('--bold');
        const fontFamily = optionFrom(clean, '--font-family') ?? optionFrom(clean, '--fontFamily');
        const maxWidthRaw = optionFrom(clean, '--max-width') ?? optionFrom(clean, '--maxWidth');
        const maxWidthEmu =
          maxWidthRaw !== undefined
            ? parseLength(lengthArg(maxWidthRaw) ?? maxWidthRaw, { axis: 'x' })
            : undefined;
        const measured = measureText({
          text,
          fontSize,
          ...(bold ? { bold: true } : {}),
          ...(fontFamily ? { fontFamily } : {}),
          ...(maxWidthEmu !== undefined ? { maxWidthEmu } : {}),
        });
        outputEnvelope({
          ok: true,
          command: 'deckuse measure',
          data: measured,
        });
        return;
      }

      if (action === 'init') {
        const source = clean[1];
        const workspace = workspaceOpt ?? clean[2];
        if (!source || !workspace) throw new Error('Usage: deckuse init <input.pptx> <workspace/>');
        ok = await execute('deckuse init', {
          version: PROTOCOL_VERSION,
          type: 'init',
          workspaceId: resolve(workspace),
          format: extname(source).slice(1).toLowerCase(),
          source: resolve(source),
        });
      } else if (action === 'new') {
        const blank = takeFlag(clean, '--blank');
        const format = (optionFrom(clean, '--format') ?? 'pptx').toLowerCase();
        const workspace = workspaceOpt ?? positionalArg(clean);
        if (!workspace) throw new Error('Usage: deckuse new <workspace/> [--format pptx|docx]');
        if (format !== 'pptx' && format !== 'docx')
          throw new Error('Usage: deckuse new <workspace/> [--format pptx|docx]');
        if (blank && format !== 'pptx') throw new Error('--blank requires --format pptx');
        const width = optionFrom(clean, '--width'),
          height = optionFrom(clean, '--height');
        const unit = optionFrom(clean, '--unit');
        if ((width === undefined) !== (height === undefined) || (unit && !width))
          throw new Error('--width and --height must be supplied together');
        if (width && format !== 'pptx')
          throw new Error('Page dimensions currently require --format pptx');
        if (unit && !['in', 'cm', 'mm', 'pt', 'px', 'emu'].includes(unit))
          throw new Error('Invalid --unit');
        const dimension = (value: string) => {
          if (unit && !/^\d+(?:\.\d+)?$/.test(value))
            throw new Error('--unit requires bare numeric dimensions');
          return unit ? value + unit : value;
        };
        const source =
          format === 'docx'
            ? await assertDefaultDocxExists()
            : await assertDefaultPptxExists(blank);
        ok = await execute('deckuse new', {
          version: PROTOCOL_VERSION,
          type: 'init',
          workspaceId: resolve(workspace),
          format,
          source,
          ...(width && height
            ? { pageSize: { width: dimension(width), height: dimension(height) } }
            : {}),
        });
      } else if (action === 'preflight-chart-data') {
        const workspace = await findWorkspace(workspaceOpt);
        const target = positionalArg(clean),
          properties = optionFrom(clean, '--properties');
        if (!target || !properties)
          throw new Error('Usage: deckuse preflight-chart-data <target> --properties <json>');
        ok = await execute('deckuse preflight-chart-data', {
          version: PROTOCOL_VERSION,
          type: 'preflightChartData',
          workspaceId: workspace,
          target,
          properties: JSON.parse(properties) as unknown,
        });
      } else if (action === 'comments' || action === 'revisions') {
        const sub = clean[1] ?? '';
        const workspace = await findWorkspace(workspaceOpt);
        const commentTypes: Record<string, string> = {
          list: 'listComments',
          get: 'getComment',
          add: 'addComment',
          update: 'updateComment',
          reply: 'replyComment',
          resolve: 'resolveComment',
          reopen: 'reopenComment',
          delete: 'deleteComment',
          upgrade: 'upgradeComments',
        };
        const revisionTypes: Record<string, string> = {
          list: 'listRevisions',
          get: 'getRevision',
          view: 'readReview',
          preview: 'previewRevisionDecision',
          propose: 'proposeChanges',
          accept: 'acceptRevisions',
          reject: 'rejectRevisions',
        };
        const type = (action === 'comments' ? commentTypes : revisionTypes)[sub];
        if (!type) throw new Error(`Unknown ${action} subcommand: ${sub}`);
        const input = optionFrom(clean, '--input');
        const payload: Record<string, unknown> = input
          ? (JSON.parse(
              input === '-' ? await readStdin() : await readFile(resolve(input), 'utf8'),
            ) as Record<string, unknown>)
          : {};
        const jsonOption = (name: string): unknown => {
          const value = optionFrom(clean, name);
          return value ? (JSON.parse(value) as unknown) : undefined;
        };
        if (['get', 'update', 'reply', 'resolve', 'reopen', 'delete'].includes(sub))
          payload['id'] = payload['id'] ?? clean[2];
        for (const name of ['author', 'anchor', 'operations', 'ids']) {
          const value = jsonOption('--' + name);
          if (value !== undefined) payload[name] = value;
        }
        for (const name of ['text', 'format', 'decision', 'view']) {
          const value = optionFrom(clean, '--' + name);
          if (value !== undefined) payload[name] = value;
        }
        if (clean.includes('--thread')) payload['thread'] = true;
        if (clean.includes('--all')) payload['all'] = true;
        const write = REVIEW_WRITES.has(type);
        const extras = write
          ? await mutationExtras(workspace)
          : { version: PROTOCOL_VERSION, workspaceId: workspace };
        ok = await execute(`deckuse ${action} ${sub}`, {
          ...payload,
          ...extras,
          ...(write
            ? {
                expectRevision:
                  expectRevisionOpt ?? payload['expectRevision'] ?? (await revisionFor(workspace)),
                transactionId:
                  payload['transactionId'] ?? (extras as { transactionId?: string }).transactionId,
              }
            : {}),
          type,
        });
      } else if (action === 'status') {
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        ok = await execute('deckuse status', {
          version: PROTOCOL_VERSION,
          type: 'status',
          workspaceId: workspace,
        });
      } else if (action === 'list') {
        const resource = clean[1];
        const resources = [
          'slides',
          'shapes',
          'layouts',
          'masters',
          'theme',
          'paragraphs',
          'tables',
          'sections',
          'styles',
          'bookmarks',
        ] as const;
        if (!resource || !resources.includes(resource as (typeof resources)[number]))
          throw new Error(
            'Usage: deckuse list <slides|shapes|layouts|masters|theme|paragraphs|tables|sections|styles|bookmarks>',
          );
        const workspace = await findWorkspace(workspaceOpt);
        const slide = optionFrom(clean, '--slide');
        const master = optionFrom(clean, '--master');
        const layout = optionFrom(clean, '--layout');
        ok = await execute(`deckuse list ${resource}`, {
          version: PROTOCOL_VERSION,
          type: 'list',
          workspaceId: workspace,
          resource: resource as (typeof resources)[number],
          ...(slide ? { slide: Number(slide) } : {}),
          ...(master ? { master } : {}),
          ...(layout ? { layout } : {}),
        });
      } else if (action === 'get') {
        const target = clean[1];
        if (!target) throw new Error('Usage: deckuse get <target> [--resolve both] [--json]');
        const workspace = await findWorkspace(workspaceOpt);
        const resolveMode = optionFrom(clean, '--resolve') ?? 'both';
        const propsRaw = optionFrom(clean, '--props');
        ok = await execute('deckuse get', {
          version: PROTOCOL_VERSION,
          type: 'get',
          workspaceId: workspace,
          target,
          resolve: resolveMode,
          provenance: !clean.includes('--no-provenance'),
          ...(propsRaw ? { props: propsRaw.split(',').map((p) => p.trim()) } : {}),
        });
      } else if (action === 'inspect') {
        const target = clean[1];
        const workspace = await findWorkspace(workspaceOpt);
        ok = await execute('deckuse inspect', {
          version: PROTOCOL_VERSION,
          type: 'inspect',
          workspaceId: workspace,
          ...(target && !target.startsWith('--') ? { target } : {}),
          visualTree: clean.includes('--visual-tree'),
          depth: Number(optionFrom(clean, '--depth') ?? 2),
        });
      } else if (action === 'search') {
        const kind = clean[1];
        if (kind !== 'text' && kind !== 'shape')
          throw new Error('Usage: deckuse search <text|shape> ...');
        const workspace = await findWorkspace(workspaceOpt);
        const query = kind === 'text' ? clean[2] : optionFrom(clean, '--query');
        ok = await execute('deckuse search', {
          version: PROTOCOL_VERSION,
          type: 'search',
          workspaceId: workspace,
          kind,
          ...(query ? { query } : {}),
          ...(optionFrom(clean, '--name') ? { name: optionFrom(clean, '--name') } : {}),
          limit: Number(optionFrom(clean, '--limit') ?? 100),
        });
      } else if (action === 'find') {
        const query = clean[1];
        if (!query || query.startsWith('--'))
          throw new Error(
            'Usage: deckuse find <query> [--slide <n>] [--kind <a,b>] [--limit <n>] [--model <id>]',
          );
        const workspace = await findWorkspace(workspaceOpt);
        const slide = optionFrom(clean, '--slide');
        const kindRaw = optionFrom(clean, '--kind');
        const limit = optionFrom(clean, '--limit');
        const model = optionFrom(clean, '--model');
        const kinds = kindRaw
          ?.split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        ok = await execute('deckuse find', {
          version: PROTOCOL_VERSION,
          type: 'find',
          workspaceId: workspace,
          query,
          ...(slide ? { slide: Number(slide) } : {}),
          ...(kinds && kinds.length > 0 ? { kind: kinds } : {}),
          ...(limit ? { limit: Number(limit) } : {}),
          ...(model ? { model } : {}),
        });
      } else if (action === 'add') {
        const what = clean[1];
        const workspace = await findWorkspace(workspaceOpt);
        const base = await mutationExtras(workspace);
        if (what === 'slide') {
          ok = await execute('deckuse add slide', {
            ...base,
            type: 'addSlide',
            ...(optionFrom(clean, '--after')
              ? { after: Number(optionFrom(clean, '--after')) }
              : {}),
            ...(optionFrom(clean, '--layout') ? { layout: optionFrom(clean, '--layout') } : {}),
            ...(optionFrom(clean, '--name') ? { name: optionFrom(clean, '--name') } : {}),
          });
        } else if (what === 'shape') {
          const slide = optionFrom(clean, '--slide');
          const shapeType = optionFrom(clean, '--type');
          if (!slide || !shapeType)
            throw new Error(
              'Usage: deckuse add shape --slide <n> --type <text|rect|rounded-rect|ellipse|line|connector|elbow|arrow|chevron|circular-arrow|image|group|table|chart|…>',
            );
          const rowsRaw = optionFrom(clean, '--rows');
          let rows: string[][] | undefined;
          if (rowsRaw !== undefined) {
            try {
              const parsed: unknown = JSON.parse(rowsRaw);
              if (
                !Array.isArray(parsed) ||
                !parsed.every(
                  (row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'),
                )
              ) {
                throw new Error('expected string[][]');
              }
              rows = parsed;
            } catch {
              throw new Error(
                `--rows must be JSON string[][] (example: --rows '[["A","B"],["1","2"]]')`,
              );
            }
          }
          const dataRaw = optionFrom(clean, '--data');
          let data:
            | {
                title?: string;
                categories: string[];
                series: { name: string; values: number[] }[];
              }
            | undefined;
          if (dataRaw !== undefined) {
            try {
              data = JSON.parse(dataRaw) as typeof data;
            } catch {
              throw new Error(
                `--data must be JSON (example: --data '{"categories":["Q1"],"series":[{"name":"S1","values":[1]}]}')`,
              );
            }
          }
          const chartType = optionFrom(clean, '--chart-type');
          const textRaw = takeFlag(clean, '--text-raw');
          const textFile = optionFrom(clean, '--text-file');
          const textOpt = optionFrom(clean, '--text');
          const initialText = await resolveCliText({
            ...(textOpt !== undefined ? { value: textOpt } : {}),
            ...(textFile !== undefined ? { textFile } : {}),
            raw: textRaw,
          });
          const theme = optionFrom(clean, '--theme');
          const alignColumnsRaw = optionFrom(clean, '--align-columns');
          let alignColumns: ('l' | 'ctr' | 'r' | 'left' | 'center' | 'right')[] | undefined;
          if (alignColumnsRaw) {
            try {
              alignColumns = JSON.parse(alignColumnsRaw) as typeof alignColumns;
            } catch {
              alignColumns = alignColumnsRaw.split(',').map((s) => s.trim()) as typeof alignColumns;
            }
          }
          ok = await execute('deckuse add shape', {
            ...base,
            type: 'addShape',
            slide: Number(slide),
            shapeType,
            ...(optionFrom(clean, '--name') ? { name: optionFrom(clean, '--name') } : {}),
            ...(optionFrom(clean, '--role') ? { role: optionFrom(clean, '--role') } : {}),
            ...(lengthArg(optionFrom(clean, '--x')) !== undefined
              ? { x: lengthArg(optionFrom(clean, '--x')) }
              : {}),
            ...(lengthArg(optionFrom(clean, '--y')) !== undefined
              ? { y: lengthArg(optionFrom(clean, '--y')) }
              : {}),
            ...(lengthArg(optionFrom(clean, '--width')) !== undefined
              ? { width: lengthArg(optionFrom(clean, '--width')) }
              : {}),
            ...(lengthArg(optionFrom(clean, '--height')) !== undefined
              ? { height: lengthArg(optionFrom(clean, '--height')) }
              : {}),
            ...(optionFrom(clean, '--file') ? { file: optionFrom(clean, '--file') } : {}),
            ...(initialText !== undefined ? { text: initialText } : {}),
            ...(rows !== undefined ? { rows } : {}),
            ...(theme ? { theme } : {}),
            ...(alignColumns ? { alignColumns } : {}),
            ...(chartType ? { chartType } : {}),
            ...(data !== undefined ? { data } : {}),
            ...(takeFlag(clean, '--show-data-labels') ? { showDataLabels: true } : {}),
          });
        } else if (what === 'paragraph') {
          const textRaw = takeFlag(clean, '--text-raw');
          const textFile = optionFrom(clean, '--text-file');
          const textOpt = optionFrom(clean, '--text');
          const initialText = await resolveCliText({
            ...(textOpt !== undefined ? { value: textOpt } : {}),
            ...(textFile !== undefined ? { textFile } : {}),
            raw: textRaw,
          });
          const blocksRaw = optionFrom(clean, '--blocks');
          let blocks: unknown;
          if (blocksRaw !== undefined) {
            try {
              blocks = JSON.parse(blocksRaw);
            } catch {
              throw new Error('--blocks must be a JSON array of {text|runs, fontSize?, ...}');
            }
          }
          const levelRaw = optionFrom(clean, '--level');
          ok = await execute('deckuse add paragraph', {
            ...base,
            type: 'addParagraph',
            ...(optionFrom(clean, '--after') ? { after: optionFrom(clean, '--after') } : {}),
            ...(optionFrom(clean, '--style') ? { style: optionFrom(clean, '--style') } : {}),
            ...(levelRaw !== undefined ? { level: Number(levelRaw) } : {}),
            ...(optionFrom(clean, '--name') ? { name: optionFrom(clean, '--name') } : {}),
            ...(initialText !== undefined ? { text: initialText } : {}),
            ...(blocks !== undefined ? { blocks } : {}),
          });
        } else if (what === 'table') {
          const rowsRaw = optionFrom(clean, '--rows');
          if (!rowsRaw)
            throw new Error(
              `Usage: deckuse add table --rows '[["A","B"],["1","2"]]' [--name <bookmark>] [--after <target>]`,
            );
          let rows: string[][];
          try {
            const parsed: unknown = JSON.parse(rowsRaw);
            if (
              !Array.isArray(parsed) ||
              !parsed.every(
                (row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'),
              )
            ) {
              throw new Error('expected string[][]');
            }
            rows = parsed;
          } catch {
            throw new Error(
              `--rows must be JSON string[][] (example: --rows '[["A","B"],["1","2"]]')`,
            );
          }
          ok = await execute('deckuse add table', {
            ...base,
            type: 'addTable',
            rows,
            ...(optionFrom(clean, '--after') ? { after: optionFrom(clean, '--after') } : {}),
            ...(optionFrom(clean, '--name') ? { name: optionFrom(clean, '--name') } : {}),
          });
        } else if (what === 'break') {
          ok = await execute('deckuse add break', {
            ...base,
            type: 'insertBreak',
            kind: 'page',
            ...(optionFrom(clean, '--after') ? { after: optionFrom(clean, '--after') } : {}),
          });
        } else throw new Error('Usage: deckuse add <slide|shape|paragraph|table|break> ...');
      } else if (action === 'remove') {
        const target = clean[1];
        if (!target) throw new Error('Usage: deckuse remove <target>');
        const workspace = await findWorkspace(workspaceOpt);
        ok = await execute('deckuse remove', {
          ...(await mutationExtras(workspace)),
          type: 'remove',
          target,
          ...(optionFrom(clean, '--comments-policy')
            ? { commentsPolicy: optionFrom(clean, '--comments-policy') }
            : {}),
        });
      } else if (action === 'set') {
        const workspace = await findWorkspace(workspaceOpt);
        const base = await mutationExtras(workspace);
        if (clean[1] === 'text') {
          const target = clean[2];
          const textRaw = takeFlag(clean, '--text-raw');
          const textFile = optionFrom(clean, '--text-file');
          const valueOpt = optionFrom(clean, '--value');
          const blocksRaw = optionFrom(clean, '--blocks');
          if (!target)
            throw new Error(
              'Usage: deckuse set text <target> --value <text> | --text-file <path> | --blocks <json>',
            );
          if (blocksRaw !== undefined) {
            let blocks: unknown;
            try {
              blocks = JSON.parse(blocksRaw);
            } catch {
              throw new Error('--blocks must be JSON array of {text, fontSize?, textColor?, ...}');
            }
            ok = await execute('deckuse set text', {
              ...base,
              type: 'setText',
              target,
              blocks,
            });
          } else {
            const value = await resolveCliText({
              ...(valueOpt !== undefined ? { value: valueOpt } : {}),
              ...(textFile !== undefined ? { textFile } : {}),
              raw: textRaw,
            });
            if (value === undefined)
              throw new Error(
                'Usage: deckuse set text <target> --value <text> | --text-file <path> | --blocks <json>',
              );
            ok = await execute('deckuse set text', {
              ...base,
              type: 'setText',
              target,
              value,
            });
          }
        } else if (clean[1] === 'slide-layout') {
          const slideRaw = optionFrom(clean, '--slide');
          const layout = optionFrom(clean, '--layout');
          if (!slideRaw || !layout)
            throw new Error(
              'Usage: deckuse set slide-layout --slide <n> --layout <index|layout:N|slide:N|name>',
            );
          const slide = Number(slideRaw);
          if (!Number.isInteger(slide) || slide < 1)
            throw new Error('--slide must be a positive integer');
          ok = await execute('deckuse set slide-layout', {
            ...base,
            type: 'setSlideLayout',
            slide,
            layout,
          });
        } else {
          const target = clean[1];
          if (!target) throw new Error('Usage: deckuse set <target> --font.size 42 ...');
          const props = parseProps(clean.slice(2));
          delete props['scope'];
          const scope = optionFrom(clean, '--scope') ?? 'local';
          // remove flag keys that are not properties
          for (const key of Object.keys(props)) {
            if (
              ['expect-revision', 'reason', 'dry-run', 'workspace', 'json', 'quiet'].includes(key)
            )
              Reflect.deleteProperty(props, key);
          }
          ok = await execute('deckuse set', {
            ...base,
            type: 'set',
            target,
            properties: props,
            scope,
          });
        }
      } else if (action === 'replace-text') {
        const source = optionFrom(clean, '--source');
        const target = optionFrom(clean, '--target');
        if (source === undefined || target === undefined)
          throw new Error(
            'Usage: deckuse replace-text --source <text> --target <text> [--regex] [--limit <n>] [--selector <sel>]',
          );
        if (!source) throw new Error('replace-text --source must be a non-empty string');
        const workspace = await findWorkspace(workspaceOpt);
        ok = await execute('deckuse replace-text', {
          ...(await mutationExtras(workspace)),
          type: 'replaceText',
          ...(optionFrom(clean, '--format-policy')
            ? { formatPolicy: optionFrom(clean, '--format-policy') }
            : {}),
          find: source,
          replace: target,
          ...(clean.includes('--regex') ? { regex: true } : {}),
          ...(optionFrom(clean, '--limit') ? { limit: Number(optionFrom(clean, '--limit')) } : {}),
          ...(optionFrom(clean, '--selector') ? { selector: optionFrom(clean, '--selector') } : {}),
        });
      } else if (action === 'xfrm') {
        if (clean[1] !== 'set')
          throw new Error('Usage: deckuse xfrm set --slide <n> --shape <id> ...');
        const workspace = await findWorkspace(workspaceOpt);
        const slide = optionFrom(clean, '--slide');
        const shape = optionFrom(clean, '--shape');
        const target =
          optionFrom(clean, '--target') ??
          (slide && shape ? `slide:${slide}/shape:${shape}` : undefined);
        if (!target) throw new Error('xfrm set requires --target or --slide and --shape');
        ok = await execute('deckuse xfrm set', {
          ...(await mutationExtras(workspace)),
          type: 'xfrmSet',
          target,
          ...(lengthArg(optionFrom(clean, '--x')) !== undefined
            ? { x: lengthArg(optionFrom(clean, '--x')) }
            : {}),
          ...(lengthArg(optionFrom(clean, '--y')) !== undefined
            ? { y: lengthArg(optionFrom(clean, '--y')) }
            : {}),
          ...(lengthArg(optionFrom(clean, '--width') ?? optionFrom(clean, '--cx')) !== undefined
            ? { width: lengthArg(optionFrom(clean, '--width') ?? optionFrom(clean, '--cx')) }
            : {}),
          ...(lengthArg(optionFrom(clean, '--height') ?? optionFrom(clean, '--cy')) !== undefined
            ? { height: lengthArg(optionFrom(clean, '--height') ?? optionFrom(clean, '--cy')) }
            : {}),
          ...(optionFrom(clean, '--rotation')
            ? { rotation: Number(optionFrom(clean, '--rotation')) }
            : {}),
        });
      } else if (action === 'align') {
        const workspace = await findWorkspace(workspaceOpt);
        const slide = optionFrom(clean, '--slide');
        const targetsRaw = optionFrom(clean, '--targets');
        const mode = optionFrom(clean, '--mode');
        if (!slide || !targetsRaw || !mode)
          throw new Error(
            'Usage: deckuse align --slide <n> --targets <t1,t2,...> --mode <left|right|top|bottom|center-h|center-v|distribute-h|distribute-v> [--gap <length>]',
          );
        const targets = targetsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        ok = await execute('deckuse align', {
          ...(await mutationExtras(workspace)),
          type: 'alignElements',
          slide: Number(slide),
          targets,
          mode,
          ...(lengthArg(optionFrom(clean, '--gap')) !== undefined
            ? { gap: lengthArg(optionFrom(clean, '--gap')) }
            : {}),
        });
      } else if (action === 'z') {
        if (clean[1] !== 'move') throw new Error('Usage: deckuse z move <target> --above <target>');
        const target = clean[2];
        if (!target) throw new Error('Usage: deckuse z move <target> ...');
        const workspace = await findWorkspace(workspaceOpt);
        ok = await execute('deckuse z move', {
          ...(await mutationExtras(workspace)),
          type: 'zMove',
          target,
          ...(optionFrom(clean, '--above') ? { above: optionFrom(clean, '--above') } : {}),
          ...(optionFrom(clean, '--below') ? { below: optionFrom(clean, '--below') } : {}),
          ...(clean.includes('--to-front') ? { toFront: true } : {}),
          ...(clean.includes('--to-back') ? { toBack: true } : {}),
        });
      } else if (action === 'apply') {
        const input = optionFrom(clean, '--input') ?? '-';
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        const raw = input === '-' ? await readStdin() : await readFile(resolve(input), 'utf8');
        let values: unknown[] | undefined;
        let wrappedOperations: unknown[] | undefined;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            Array.isArray((parsed as { operations?: unknown }).operations) &&
            (!('type' in parsed) || (parsed as { type?: unknown }).type === 'applyTransaction')
          ) {
            wrappedOperations = (parsed as { operations: unknown[] }).operations;
          } else {
            values = Array.isArray(parsed) ? parsed : [parsed];
          }
        } catch {
          values = raw
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line) as unknown);
        }

        const extras = await mutationExtras(workspace);
        const runHighLevelBatch = async (list: unknown[]): Promise<boolean> => {
          const commands = list.map((value) => {
            if (!isRecord(value)) throw new Error('apply input must contain command objects');
            if (value['type'] === 'batch') return value;
            if (!APPLY_WRITE_TYPES.has(String(value['type'])))
              throw new Error(`apply input contains non-write command: ${String(value['type'])}`);
            return {
              ...extras,
              ...(REVIEW_WRITES.has(String(value['type']))
                ? { expectRevision: extras.expectRevision ?? extras.transactionId }
                : {}),
              ...value,
            };
          });
          const payload =
            commands.length === 1 && commands[0]?.['type'] !== 'batch'
              ? commands[0]
              : {
                  ...extras,
                  type: 'batch',
                  atomic: true,
                  commands: commands.flatMap((command) =>
                    command['type'] === 'batch'
                      ? (command as { commands: unknown[] }).commands
                      : [command],
                  ),
                };
          return execute('deckuse apply', payload);
        };

        if (wrappedOperations) {
          const classified = classifyApplyOps(wrappedOperations);
          if (classified.kind === 'invalid') throw new Error(classified.message);
          if (classified.kind === 'transaction') {
            ok = await execute('deckuse apply', {
              ...extras,
              type: 'applyTransaction',
              operations: wrappedOperations as Record<string, unknown>[],
            });
          } else {
            ok = await runHighLevelBatch(wrappedOperations);
          }
        } else {
          const list = values ?? [];
          const classified = classifyApplyOps(list);
          if (classified.kind === 'invalid') throw new Error(classified.message);
          if (classified.kind === 'transaction') {
            ok = await execute('deckuse apply', {
              ...extras,
              type: 'applyTransaction',
              operations: list as Record<string, unknown>[],
            });
          } else {
            ok = await runHighLevelBatch(list);
          }
        }
      } else if (action === 'validate') {
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        ok = await execute('deckuse validate', {
          version: PROTOCOL_VERSION,
          type: 'validate',
          profile: optionFrom(clean, '--profile') ?? 'structure',
          workspaceId: workspace,
          level: optionFrom(clean, '--level') ?? 'full',
          render: clean.includes('--render'),
          package: clean.includes('--package'),
          relationships: clean.includes('--relationships'),
          ...(optionFrom(clean, '--slide') ? { slide: Number(optionFrom(clean, '--slide')) } : {}),
        });
      } else if (action === 'history') {
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        ok = await execute('deckuse history', {
          version: PROTOCOL_VERSION,
          type: 'history',
          workspaceId: workspace,
          limit: Number(optionFrom(clean, '--limit') ?? 100),
          offset: Number(optionFrom(clean, '--offset') ?? 0),
          ...(optionFrom(clean, '--slide') ? { slide: Number(optionFrom(clean, '--slide')) } : {}),
        });
      } else if (action === 'undo') {
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        ok = await execute('deckuse undo', {
          version: PROTOCOL_VERSION,
          type: 'undo',
          workspaceId: workspace,
          steps: Number(optionFrom(clean, '--steps') ?? 1),
        });
      } else if (action === 'repair') {
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        ok = await execute('deckuse repair', {
          ...(await mutationExtras(workspace)),
          type: 'repair',
          workspaceId: workspace,
        });
      } else if (action === 'export') {
        const output = clean[1];
        if (!output) throw new Error('Usage: deckuse export <output.pptx>');
        const recoveryReport = optionFrom(clean, '--recover-report');
        if (recoveryReport) {
          const envelope: unknown = JSON.parse(await readFile(recoveryReport, 'utf8'));
          outputEnvelope({
            ok: true,
            command: 'deckuse export',
            data: await recoverPptxExport(envelope, output),
          });
          return;
        }
        if (clean.includes('--recover-report')) throw new Error('--recover-report requires a path');
        const workspace = await findWorkspace(workspaceOpt);
        const fromPackage = takeFlag(clean, '--from-package');
        const command = {
          version: PROTOCOL_VERSION,
          type: 'export',
          profile: optionFrom(clean, '--profile') ?? 'structure',
          workspaceId: workspace,
          output: resolve(output),
          ...(revisionOpt ? { revision: revisionOpt } : {}),
          ...(fromPackage ? { fromPackage: true } : {}),
        };
        const report = optionFrom(clean, '--report');
        if (!report) {
          if (clean.includes('--report')) throw new Error('--report requires a path');
          ok = await execute('deckuse export', command);
        } else {
          const reportPath = resolve(report);
          if (reportPath === command.output)
            throw new Error('--report must differ from the export output');
          const file = await open(reportPath, 'wx');
          try {
            const envelope = toEnvelope('deckuse export', await runCommand(command));
            const data = envelope.data as
              | {
                  output?: string;
                  state?: string;
                  revision?: string;
                  valid?: boolean;
                  diagnostics?: Diagnostic[];
                  visual?: { diagnostics?: Diagnostic[] };
                }
              | undefined;
            const diagnostics = new Map<string, Diagnostic>();
            for (const finding of [
              ...(data?.diagnostics ?? []),
              ...(data?.visual?.diagnostics ?? []),
              ...((envelope.error as { diagnostics?: Diagnostic[] } | undefined)?.diagnostics ??
                []),
            ])
              diagnostics.set(JSON.stringify(finding), finding);
            const counts: Record<string, number> = {};
            for (const { code } of diagnostics.values()) counts[code] = (counts[code] ?? 0) + 1;
            const summary = {
              output: data?.output ?? envelope.error?.details?.['output'],
              state: data?.state ?? envelope.error?.details?.['state'],
              revision: data?.revision ?? envelope.error?.details?.['revision'],
              valid: data?.valid ?? envelope.error?.details?.['valid'],
              diagnosticCounts: counts,
              reportPath,
            };
            try {
              await file.writeFile(JSON.stringify(envelope, null, 2) + '\n');
              await file.sync();
              outputEnvelope({
                ok: envelope.ok,
                command: envelope.command,
                ...(envelope.error
                  ? {
                      error: {
                        code: envelope.error.code,
                        message: envelope.error.message,
                        details: envelope.error.details,
                      },
                    }
                  : {}),
                data: summary,
              });
              ok = envelope.ok;
            } catch (cause) {
              outputEnvelope({
                ok: false,
                command: envelope.command,
                error: {
                  code: 'EXPORT_REPORT_WRITE_FAILED',
                  message: cause instanceof Error ? cause.message : String(cause),
                },
                data: { ...summary, reportPath: undefined, attemptedReportPath: reportPath },
              });
              ok = false;
            }
          } finally {
            await file.close();
          }
        }
      } else if (action === 'monitor') {
        const sub =
          clean[1] === 'start' || clean[1] === 'stop' || clean[1] === 'status'
            ? clean[1]
            : undefined;
        const daemonWorker = takeFlag(clean, '--daemon-worker');
        const stopAll = takeFlag(clean, '--all');
        const positionalWorkspace = sub
          ? clean[2] && !clean[2].startsWith('--')
            ? clean[2]
            : undefined
          : clean[1] && !clean[1].startsWith('--')
            ? clean[1]
            : undefined;
        const hasWorkspaceArg = Boolean(workspaceOpt ?? positionalWorkspace);
        const port = Number(optionFrom(clean, '--port') ?? 4173);
        if (!Number.isInteger(port) || port < 0 || port > 65535)
          throw new Error('--port must be an integer between 0 and 65535');
        const host = optionFrom(clean, '--host') ?? '127.0.0.1';

        if (sub === 'status' && !hasWorkspaceArg) {
          const result = await monitorStatusAll();
          outputEnvelope({
            ok: true,
            command: 'deckuse monitor status',
            data: result,
          });
          return;
        }

        if (sub === 'stop' && stopAll) {
          const result = await monitorStopAll();
          outputEnvelope({
            ok: true,
            command: 'deckuse monitor stop',
            data: result,
          });
          return;
        }

        if (sub === 'stop' && !hasWorkspaceArg) {
          const listed = await monitorStatusAll();
          const summary =
            listed.monitors.length === 0
              ? 'No running monitor daemons found.'
              : `Running monitors:\n${listed.monitors
                  .map(
                    (m) =>
                      `  pid=${String(m.pid)} port=${String(m.port)} workspace=${m.workspace} url=${m.url}`,
                  )
                  .join('\n')}`;
          outputEnvelope({
            ok: false,
            command: 'deckuse monitor stop',
            error: {
              code: 'INVALID_COMMAND',
              message:
                `Pass --workspace <path>, a workspace path argument, or --all. ` +
                `Run deckuse monitor status to list daemons.\n${summary}`,
            },
          });
          process.exitCode = 1;
          return;
        }

        const workspace = await findWorkspace(workspaceOpt ?? positionalWorkspace);

        if (sub === 'start') {
          try {
            const meta = await monitorStart(workspace, { host, port });
            outputEnvelope({
              ok: true,
              command: 'deckuse monitor start',
              data: meta,
            });
          } catch (error) {
            outputEnvelope({
              ok: false,
              command: 'deckuse monitor start',
              error: {
                code: 'IO_ERROR',
                message: error instanceof Error ? error.message : 'Monitor start failed',
              },
            });
            process.exitCode = 1;
          }
          return;
        }
        if (sub === 'stop') {
          const result = await monitorStop(workspace);
          outputEnvelope({
            ok: true,
            command: 'deckuse monitor stop',
            data: result,
          });
          return;
        }
        if (sub === 'status') {
          const result = await monitorStatus(workspace);
          outputEnvelope({
            ok: true,
            command: 'deckuse monitor status',
            data: result,
          });
          return;
        }

        const monitor = await runMonitorForeground(workspace, {
          host,
          port,
          asDaemonWorker: daemonWorker,
        });
        if (!daemonWorker) process.stdout.write(`Deckuse monitor: ${monitor.url}\n`);
        const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
          process.stderr.write(`deckuse monitor: received ${signal}, shutting down\n`);
          await monitor.close();
          process.exit(0);
        };
        process.once('SIGINT', () => void shutdown('SIGINT'));
        process.once('SIGTERM', () => void shutdown('SIGTERM'));
        return;
      } else if (action === 'render') {
        if (clean.includes('--preflight')) {
          try {
            outputEnvelope({
              ok: true,
              command: 'deckuse render',
              data: { ...(await browserPreflight()), converter: await converterPreflight() },
            });
          } catch (cause) {
            outputEnvelope({
              ok: false,
              command: 'deckuse render',
              error: renderFailurePayload(cause),
            });
            process.exitCode = 1;
          }
          return;
        }
        if (clean.some((arg) => arg === '--engine' || arg.startsWith('--engine='))) {
          outputEnvelope({
            ok: false,
            command: 'deckuse render',
            error: {
              code: 'RENDER_ENGINE_REMOVED',
              message:
                'Remove --engine: render uses deck2html and Playwright only. LibreOffice rendering and automatic engine fallback have been removed. Use render --preflight to diagnose browser availability.',
            },
          });
          process.exitCode = 2;
          return;
        }
        const pageRaw = optionFrom(clean, '--page');
        const pagesRaw = optionFrom(clean, '--pages');
        const all = clean.includes('--all');
        if (pagesRaw !== undefined || all) {
          if (pageRaw || optionFrom(clean, '--output') || (pagesRaw !== undefined && all))
            throw new Error(
              'Use --pages or --all with --output-dir; do not combine with --page/--output',
            );
          const workspace = await findWorkspace(workspaceOpt);
          const selection = pagesRaw !== undefined ? parsePageSelection(pagesRaw) : undefined;
          try {
            const rendered = await renderPages(workspace, {
              all,
              pages: selection,
              outputDir: optionFrom(clean, '--output-dir'),
              scale: optionFrom(clean, '--scale')
                ? Number(optionFrom(clean, '--scale'))
                : undefined,
            });
            outputEnvelope({ ok: rendered.ok, command: 'deckuse render', data: rendered });
            if (!rendered.ok) process.exitCode = 1;
          } catch (cause) {
            outputEnvelope({
              ok: false,
              command: 'deckuse render',
              error: renderFailurePayload(cause),
            });
            process.exitCode = 1;
          }
          return;
        }
        if (optionFrom(clean, '--output-dir'))
          throw new Error('--output-dir requires --pages or --all');
        if (!pageRaw)
          throw new Error('Usage: deckuse render --page <n> [--output <file.png>] [--scale <n>]');
        if (/\s|,|-/.test(pageRaw))
          throw new Error('--page accepts exactly one positive integer (not a range or list)');
        const page = Number(pageRaw);
        if (!Number.isInteger(page) || page < 1)
          throw new Error('--page must be a positive integer');
        const scaleRaw = optionFrom(clean, '--scale');
        const scale = scaleRaw !== undefined ? Number(scaleRaw) : undefined;
        if (scale !== undefined && !(scale > 0))
          throw new Error('--scale must be a positive number');
        const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
        const outputOpt = optionFrom(clean, '--output');
        try {
          const rendered = await renderPage(workspace, {
            page,
            ...(outputOpt ? { output: resolve(outputOpt) } : {}),
            ...(scale !== undefined ? { scale } : {}),
          });
          outputEnvelope({
            ok: true,
            command: 'deckuse render',
            warnings: [...rendered.warnings],
            data: {
              ...rendered,
              page: rendered.page,
              output: rendered.output,
              warnings: rendered.warnings,
              diagnostics: rendered.diagnostics,
            },
          });
        } catch (error) {
          outputEnvelope({
            ok: false,
            command: 'deckuse render',
            error: renderFailurePayload(error),
          });
          ok = false;
        }
      } else if (action === 'query') {
        // With `--workspace`, positionals are the selector. Without it, the
        // first positional is the workspace and the rest are the selector.
        // Canonical-same paths are ignored (even when they contain `=`).
        // A second, different directory is CONFLICTING_WORKSPACE, not a filter.
        const positionals = positionalArgs(clean);
        const workspace = await findWorkspace(workspaceOpt ?? positionals[0]);
        const selectorTokens = workspaceOpt ? positionals : positionals.slice(1);
        const workspaceKey = await canonicalPath(workspace);
        const selectors: string[] = [];
        let conflict: string | undefined;
        for (const token of selectorTokens) {
          const key = await canonicalPath(token);
          if (key === workspaceKey) continue;
          if (await isDirectory(token)) {
            conflict = token;
            break;
          }
          selectors.push(token);
        }
        if (conflict) {
          outputEnvelope({
            ok: false,
            command: 'deckuse query',
            error: {
              code: 'CONFLICTING_WORKSPACE',
              message: `Workspace path ${conflict} does not match ${workspace}`,
              hint: 'Pass the workspace once, via --workspace or as the first positional path.',
            },
          });
          ok = false;
        } else {
          const selector = selectors.length > 0 ? selectors.join(' ') : '*';
          if (selector !== '*' && selector !== 'all' && (await isDirectory(selector))) {
            outputEnvelope({
              ok: false,
              command: 'deckuse query',
              error: {
                code: 'CONFLICTING_WORKSPACE',
                message: `Selector ${selector} looks like a directory path, not a filter`,
                hint: 'Pass the workspace once, via --workspace or as the first positional path.',
              },
            });
            ok = false;
          } else {
            ok = await execute('deckuse query', {
              version: PROTOCOL_VERSION,
              type: 'query',
              workspaceId: workspace,
              selector,
              limit: Number(optionFrom(clean, '--limit') ?? 100),
            });
          }
        }
      } else {
        throw new Error(`Unknown command: ${action}`);
      }

      if (!ok) process.exitCode = 1;
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Invalid input';
    if (json)
      outputEnvelope({
        ok: false,
        command: `deckuse ${clean[0] ?? 'cli'}`,
        warnings: [],
        error: { code: 'INVALID_INPUT', message },
      });
    else process.stderr.write(`deckuse: ${message}\n`);
    process.exitCode = 2;
  }
};

void main();
