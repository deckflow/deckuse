#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
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
} from '@deckflow/deckuse-core';
import { resolveCliText } from './cli-text.js';
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
import { renderPage } from './render.js';
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
      warnings: result.diagnostics
        .filter((d) => d.severity === 'warning')
        .map((d) => d.message),
      error: {
        code: result.error.code,
        message: result.error.message,
        ...(result.error.target ? { target: result.error.target } : {}),
        ...(result.error.hint ? { hint: result.error.hint } : {}),
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
      ...result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message),
      ...(Array.isArray(value['warnings']) ? (value['warnings'] as string[]) : []),
    ],
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
  if (revisionOpt && command && typeof command === 'object' && command !== null) {
    const type = (command as { type?: string }).type;
    if (
      type &&
      ![
        'status',
        'list',
        'get',
        'inspect',
        'search',
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
  for (let i = 0; i < list.length; ) {
    const token = list[i]!;
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

/** Pass through bare numbers as number; keep unit strings for protocol parseLength. */
const lengthArg = (raw: string | undefined): number | string | undefined => {
  if (raw === undefined) return undefined;
  if (raw === 'auto') return 'auto';
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
};

const APPLY_WRITE_TYPES = new Set([
  'setText',
  'replaceText',
  'setTransform',
  'setProperties',
  'set',
  'xfrmSet',
  'zMove',
  'add',
  'addSlide',
  'addShape',
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
  if (ops.length === 0) return { kind: 'invalid', message: 'apply input operations array is empty' };
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

    const action = clean[0]!;
    let ok = true;

    if (action === 'schema') {
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
        schema = { ...(resolveRef(match) ?? match), $defs: defs };
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
      if (text === undefined) throw new Error('Usage: deckuse measure --text <string> --font-size <pt>');
      const fontSize = Number(optionFrom(clean, '--font-size') ?? optionFrom(clean, '--fontSize') ?? 12);
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
      if (!source || !workspace)
        throw new Error('Usage: deckuse init <input.pptx> <workspace/>');
      ok = await execute('deckuse init', {
        version: PROTOCOL_VERSION,
        type: 'init',
        workspaceId: resolve(workspace),
        format: extname(source).slice(1).toLowerCase(),
        source: resolve(source),
      });
    } else if (action === 'status') {
      const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
      ok = await execute('deckuse status', {
        version: PROTOCOL_VERSION,
        type: 'status',
        workspaceId: workspace,
      });
    } else if (action === 'list') {
      const resource = clean[1] as 'slides' | 'shapes' | 'layouts' | 'masters' | 'theme';
      if (!resource) throw new Error('Usage: deckuse list <slides|shapes|layouts|masters|theme>');
      const workspace = await findWorkspace(workspaceOpt);
      const slide = optionFrom(clean, '--slide');
      ok = await execute(`deckuse list ${resource}`, {
        version: PROTOCOL_VERSION,
        type: 'list',
        workspaceId: workspace,
        resource,
        ...(slide ? { slide: Number(slide) } : {}),
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
      const kind = clean[1] as 'text' | 'shape';
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
    } else if (action === 'add') {
      const what = clean[1];
      const workspace = await findWorkspace(workspaceOpt);
      const base = await mutationExtras(workspace);
      if (what === 'slide') {
        ok = await execute('deckuse add slide', {
          ...base,
          type: 'addSlide',
          ...(optionFrom(clean, '--after') ? { after: Number(optionFrom(clean, '--after')) } : {}),
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
            rows = parsed as string[][];
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
        let alignColumns: Array<'l' | 'ctr' | 'r' | 'left' | 'center' | 'right'> | undefined;
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
      } else throw new Error('Usage: deckuse add <slide|shape> ...');
    } else if (action === 'remove') {
      const target = clean[1];
      if (!target) throw new Error('Usage: deckuse remove <target>');
      const workspace = await findWorkspace(workspaceOpt);
      ok = await execute('deckuse remove', {
        ...(await mutationExtras(workspace)),
        type: 'remove',
        target,
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
      } else {
        const target = clean[1];
        if (!target) throw new Error('Usage: deckuse set <target> --font.size 42 ...');
        const props = parseProps(clean.slice(2));
        delete props['scope'];
        const scope = optionFrom(clean, '--scope') ?? 'local';
        // remove flag keys that are not properties
        for (const key of Object.keys(props)) {
          if (['expect-revision', 'reason', 'dry-run', 'workspace', 'json', 'quiet'].includes(key))
            delete props[key];
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
      if (!source)
        throw new Error('replace-text --source must be a non-empty string');
      const workspace = await findWorkspace(workspaceOpt);
      ok = await execute('deckuse replace-text', {
        ...(await mutationExtras(workspace)),
        type: 'replaceText',
        find: source,
        replace: target,
        ...(clean.includes('--regex') ? { regex: true } : {}),
        ...(optionFrom(clean, '--limit')
          ? { limit: Number(optionFrom(clean, '--limit')) }
          : {}),
        ...(optionFrom(clean, '--selector')
          ? { selector: optionFrom(clean, '--selector') }
          : {}),
      });
    } else if (action === 'xfrm') {
      if (clean[1] !== 'set') throw new Error('Usage: deckuse xfrm set --slide <n> --shape <id> ...');
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
      const targets = targetsRaw.split(',').map((t) => t.trim()).filter(Boolean);
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
          Array.isArray((parsed as { operations?: unknown }).operations)
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
          return { ...extras, ...value };
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
                    ? ((command as { commands: unknown[] }).commands ?? [])
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
        workspaceId: workspace,
        level: optionFrom(clean, '--level') ?? 'full',
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
    } else if (action === 'export') {
      const output = clean[1];
      if (!output) throw new Error('Usage: deckuse export <output.pptx>');
      const workspace = await findWorkspace(workspaceOpt);
      const fromPackage = takeFlag(clean, '--from-package');
      ok = await execute('deckuse export', {
        version: PROTOCOL_VERSION,
        type: 'export',
        workspaceId: workspace,
        output: resolve(output),
        ...(revisionOpt ? { revision: revisionOpt } : {}),
        ...(fromPackage ? { fromPackage: true } : {}),
      });
    } else if (action === 'monitor') {
      const sub =
        clean[1] === 'start' || clean[1] === 'stop' || clean[1] === 'status' ? clean[1] : undefined;
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
      const host = optionFrom(clean, '--host') ?? '0.0.0.0';

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
      const pageRaw = optionFrom(clean, '--page');
      if (!pageRaw)
        throw new Error('Usage: deckuse render --page <n> [--output <file.png>] [--scale <n>]');
      if (/\s|,|-/.test(pageRaw))
        throw new Error('--page accepts exactly one positive integer (not a range or list)');
      const page = Number(pageRaw);
      if (!Number.isInteger(page) || page < 1)
        throw new Error('--page must be a positive integer');
      const scaleRaw = optionFrom(clean, '--scale');
      const scale = scaleRaw !== undefined ? Number(scaleRaw) : undefined;
      if (scale !== undefined && !(scale > 0)) throw new Error('--scale must be a positive number');
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
          data: { page: rendered.page, output: rendered.output, warnings: rendered.warnings },
        });
      } catch (error) {
        outputEnvelope({
          ok: false,
          command: 'deckuse render',
          error: {
            code: 'RENDER_FAILED',
            message: error instanceof Error ? error.message : 'Render failed',
          },
        });
        ok = false;
      }
    } else if (action === 'query') {
      // Back-compat shim
      const workspace = await findWorkspace(workspaceOpt ?? clean[1]);
      ok = await execute('deckuse query', {
        version: PROTOCOL_VERSION,
        type: 'query',
        workspaceId: workspace,
        selector: clean[2] ?? '*',
        limit: Number(optionFrom(clean, '--limit') ?? 100),
      });
    } else {
      throw new Error(`Unknown command: ${action}`);
    }

    if (!ok) process.exitCode = 1;
  }
} catch (cause) {
  process.stderr.write(`deckuse: ${cause instanceof Error ? cause.message : 'Invalid input'}\n`);
  process.exitCode = 2;
}
};

void main();
