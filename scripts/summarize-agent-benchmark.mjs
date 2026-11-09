#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
if (process.argv[2] === '--agent-log') {
  const { analyzeAgentLog } = await import('./agent-log-analysis.mjs');
  const input = process.argv[3];
  if (!input)
    throw new Error(
      'Usage: summarize-agent-benchmark.mjs --agent-log <events.jsonl> [new-report.json]',
    );
  const events = (await readFile(input, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map(JSON.parse);
  const output = JSON.stringify(analyzeAgentLog(events), null, 2) + '\n';
  if (process.argv[4]) await writeFile(process.argv[4], output, { flag: 'wx' });
  else process.stdout.write(output);
  process.exit(0);
}
const file = process.argv[2];
const report = JSON.parse(await readFile(file, 'utf8'));
const roots = (await readdir(tmpdir()))
  .filter((n) => n.startsWith('deckuse-benchmark-'))
  .map((n) => join(tmpdir(), n));
for (const row of report.rows) {
  let trace = row.traceFile;
  if (!trace) {
    for (const root of roots) {
      const candidate = join(root, `${row.temperature}-${row.iteration}-${row.mode}.jsonl`);
      try {
        const first = JSON.parse((await readFile(candidate, 'utf8')).split('\n')[0]);
        if (first.pid === row.phases[0].pid && first.at === row.phases[0].at) {
          trace = candidate;
          break;
        }
      } catch {
        /* A different benchmark fixture. */
      }
    }
  }
  if (!trace) throw Error('Cannot locate raw phase trace');
  row.phases = (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  row.phaseTotalsMs = {};
  for (const event of row.phases)
    row.phaseTotalsMs[event.phase] = (row.phaseTotalsMs[event.phase] ?? 0) + event.durationMs;
  const intervals = row.phases.map((p) => [p.at - p.durationMs, p.at]).sort((a, b) => a[0] - b[0]);
  let union = 0,
    start,
    end;
  for (const [a, b] of intervals) {
    if (end === undefined) {
      start = a;
      end = b;
    } else if (a <= end) end = Math.max(end, b);
    else {
      union += end - start;
      start = a;
      end = b;
    }
  }
  if (end !== undefined) union += end - start;
  row.phaseUnionMs = union;
  if (row.mode === 'batch') {
    const root = dirname(trace);
    let identical = 0;
    for (let page = 1; page <= 8; page++) {
      const a = await readFile(
        join(root, 'render', `${row.temperature}-${row.iteration}-batch-${page}.png`),
      );
      const b = await readFile(
        join(root, 'render', `${row.temperature}-${row.iteration}-batch-batch`, `page-${page}.png`),
      );
      if (
        createHash('sha256').update(a).digest('hex') ===
        createHash('sha256').update(b).digest('hex')
      )
        identical++;
    }
    row.identicalHtmlPreviewPages = identical;
  }
}
report.notes.push(
  'Phase spans were reloaded from the complete raw traces, including rendering. Union duration avoids double-counting overlapping spans.',
);
await writeFile(file, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    summary: report.summary,
    rows: report.rows.length,
    renderFailures: report.rows.flatMap((r) => r.render).filter((r) => r.error).length,
    identicalPages: report.rows
      .filter((r) => r.mode === 'batch')
      .map((r) => r.identicalHtmlPreviewPages),
  }),
);
