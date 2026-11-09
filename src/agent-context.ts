import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandJsonSchema, PROTOCOL_VERSION } from './core/schema.js';
import { pptxCapabilities } from './pptx/adapter.js';
import { docxCapabilities } from './docx/adapter.js';
import { EDITION } from './edition.js';
import { version } from './version.js';
import { browserConfiguration } from './render-browser.js';

type RecordValue = Record<string, unknown>;
const isRecord = (v: unknown): v is RecordValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function taskSchemas(types: readonly string[]) {
  const full = commandJsonSchema as RecordValue;
  const defs = (full['$defs'] ?? {}) as RecordValue;
  const deref = (v: unknown): RecordValue | undefined => {
    if (!isRecord(v)) return undefined;
    return typeof v['$ref'] === 'string'
      ? (defs[v['$ref'].replace('#/$defs/', '')] as RecordValue)
      : v;
  };
  const variants = (full['oneOf'] ?? full['anyOf']) as unknown[];
  const selected: unknown[] = [];
  for (const type of types) {
    const entry = variants.find((v) => {
      const properties = deref(v)?.['properties'];
      return isRecord(properties) && deref(properties['type'])?.['const'] === type;
    });
    if (!entry) throw new Error(`Unknown command type: ${type}`);
    selected.push(deref(entry));
  }
  const reachable: RecordValue = {};
  function visit(v: unknown): void {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (!isRecord(v)) return;
    if (typeof v['$ref'] === 'string' && v['$ref'].startsWith('#/$defs/')) {
      const key = v['$ref'].slice(8);
      if (!(key in reachable)) {
        reachable[key] = defs[key];
        visit(defs[key]);
      }
    }
    Object.values(v).forEach(visit);
  }
  selected.forEach(visit);
  return { anyOf: selected, $defs: reachable };
}
export async function agentContext(options: {
  format?: string;
  workspace?: string;
  scenario?: string;
  includeSchema?: boolean;
}) {
  let format = options.format ?? 'pptx';
  let dynamic: RecordValue | undefined;
  if (options.workspace) {
    const manifest = JSON.parse(
      await readFile(join(options.workspace, '.deckuse/manifest.json'), 'utf8'),
    ) as { format: string; revision: string };
    if (options.format && options.format !== manifest.format)
      throw new Error('Requested format does not match workspace');
    format = manifest.format;
    dynamic = {
      revision: manifest.revision,
      health: 'not-probed',
      inventory: 'not-loaded',
      cache: 'never reuse dynamic state for later writes',
    };
  }
  if (format !== 'pptx' && format !== 'docx')
    throw new Error('agent-context supports pptx or docx');
  const scenario = options.scenario ?? 'create';
  const manifest = JSON.parse(
    await readFile(
      join(dirname(fileURLToPath(import.meta.url)), '../skills/deckuse/manifest.json'),
      'utf8',
    ),
  ) as {
    minimumCliVersion: string;
    scenarios: Record<string, { formats: string[]; resource: string }>;
    formatOverrides: Record<string, Record<string, string>>;
    modules: string[];
  };
  const workflow = manifest.scenarios[scenario];
  if (!workflow?.formats.includes(format))
    throw new Error(`Unsupported scenario ${scenario} for ${format}`);
  const types =
    scenario === 'audit' || scenario === 'preview-export'
      ? ['status', 'validate', 'export']
      : format === 'docx'
        ? ['addParagraph', 'setText', 'setProperties', 'validate', 'export']
        : scenario === 'edit' || scenario === 'populate-template'
          ? ['setText', 'setProperties', 'replacePicture', 'duplicate', 'validate', 'export']
          : ['addSlide', 'addShape', 'remove', 'setText', 'setProperties', 'validate', 'export'];
  if (format === 'pptx' && !['create', 'audit', 'preview-export'].includes(scenario))
    types.push(
      'groupShapes',
      'ungroupShapes',
      'mergeTableCells',
      'unmergeTableCells',
      'preflightChartData',
      'setTableLayout',
      'xfrmSet',
    );
  const contracts = taskSchemas(types);
  const capabilities = format === 'pptx' ? pptxCapabilities : docxCapabilities;
  const identity = {
    cliVersion: version,
    protocolVersion: PROTOCOL_VERSION,
    contextSchemaVersion: 2,
    edition: EDITION,
    format,
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ identity, capabilities, contracts, scenario }))
    .digest('hex');
  const config = browserConfiguration();
  const browser = {
    provider: config.provider,
    execution: config.execution,
    executableStatus: 'unknown',
    cacheWritable: 'not-probed',
    launch: 'not-probed',
    dependencyCompatibility: 'unverified',
    installation: 'Use render --preflight to inspect the selected browser and converter.',
    ...(config.execution === 'denied' ? { available: false, code: 'BROWSER_HOST_DENIED' } : {}),
  };
  const operationFields = Object.fromEntries(
    types.map((type, i) => {
      const branch = contracts.anyOf[i] as RecordValue;
      return [
        type,
        {
          fields: Object.keys(branch['properties'] ?? {}),
          required: branch['required'] ?? [],
          additionalProperties: branch['additionalProperties'] ?? true,
          contract: `#/contracts/anyOf/${String(i)}`,
        },
      ];
    }),
  );
  const example = 'skills/deckuse/examples/create-blank-pptx.json';
  const sample =
    format === 'pptx'
      ? (JSON.parse(await readFile(new URL('../' + example, import.meta.url), 'utf8')) as unknown)
      : [{ type: 'addParagraph', blocks: [{ text: 'Introduction', fontSize: 18, bold: true }] }];
  return {
    ...identity,
    capabilityFingerprint: fingerprint,
    scenario,
    capabilities,
    resource: {
      root: 'skills/deckuse (relative to installed npm package)',
      version,
      minimumCliVersion: manifest.minimumCliVersion,
      scenario: manifest.formatOverrides[format]?.[scenario] ?? workflow.resource,
      modules: manifest.modules,
      ...(format === 'pptx' && scenario === 'create' ? { example } : {}),
    },
    cache: {
      staticKey: [version, PROTOCOL_VERSION, EDITION, format, scenario, fingerprint],
      invalidate: ['binary path/build', 'version', 'edition', 'format', 'fingerprint'],
      dynamic: ['workspace revision', 'health', 'inventory', 'environment'],
      fallback:
        'If agent-context is absent, use the skill from the same installed package and schema --list / schema --type; do not retry an unknown command indefinitely.',
    },
    conventions: {
      geometry: 'Explicit px/pt/cm/in/%; bare numbers are EMU',
      targets:
        'Inventory current targets before writes; names may refer forward within the same apply',
      batch:
        'apply --input accepts a JSON array of write operations; JSON schemas below describe operations, not shell positionals',
      guards: 'Use --expect-revision with the current raw string revision',
      streams: 'Capture stdout JSON, stderr, exit code separately',
      recovery:
        format === 'pptx'
          ? 'Use one --request-id per logical apply. After response loss, query status --request-id before retry.'
          : 'After response loss reconcile status/history/inventory before retry',
      verification:
        'Validate after writes; HTML preview is approximate; native Office stays unverified',
    },
    dependencies: {
      browser,
      converter:
        'bundled dependency; executable availability is checked during render; not actively probed here',
    },
    recipe: {
      scope:
        'New document smoke recipe; use inventory and selected workflow for an existing-file task',
      operations: sample,
      optionalPreview: [
        'deckuse render --preflight --probe-browser --json',
        'deckuse render --page 1 --workspace ./ws --json',
      ],
      cli: [
        `deckuse new ./ws${format === 'docx' ? ' --format docx' : ' --blank'} --json`,
        'Save recipe.operations as ./ops.json',
        format === 'pptx'
          ? 'deckuse apply --workspace ./ws --input ./ops.json --request-id create-1 --expect-revision 1 --summary --json'
          : 'deckuse apply --workspace ./ws --input ./ops.json --json',
        'deckuse validate --workspace ./ws --json',
        `deckuse export ./output.${format} --workspace ./ws --json`,
      ],
    },
    operationTypes: types,
    operationFields,
    ...(options.includeSchema ? { contracts } : {}),
    ...(dynamic ? { dynamic } : {}),
  };
}
