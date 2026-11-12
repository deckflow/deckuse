/** Read-only analysis of managed-host events. Never emits prompt or tool payloads. */
export function intervalUnion(intervals) {
  const merged = [];
  for (const [start, end] of intervals.filter(([s, e]) => e >= s).sort((a, b) => a[0] - b[0])) {
    if (merged.length && start <= merged.at(-1)[1])
      merged.at(-1)[1] = Math.max(end, merged.at(-1)[1]);
    else merged.push([start, end]);
  }
  return merged.reduce((total, [start, end]) => total + end - start, 0);
}
function contentText(event) {
  return (Array.isArray(event.content) ? event.content : [])
    .map((part) => part.text ?? '')
    .join('\n');
}
function isRequest(event) {
  if (event.type !== 'message' || event.role !== 'user') return false;
  const text = contentText(event);
  if (/<(?:cb_summary|task-notification)\b/.test(text)) return false;
  return (
    /<user_query>[\s\S]*\S[\s\S]*<\/user_query>/.test(text) ||
    event.providerData?.startsNewUserRequest === true
  );
}
function argsOf(event) {
  try {
    return JSON.parse(event.arguments);
  } catch {
    return { command: event.providerData?.argumentsDisplayText ?? '' };
  }
}
function milestoneKinds(event) {
  const args = argsOf(event);
  const command = args.command ?? '';
  const path = args.file_path ?? '';
  const kinds = [];
  if (/\bnpm\s+(?:install|i)\b/.test(command)) kinds.push('installation');
  if (/\bagent-context\b/.test(command)) kinds.push('contract');
  if (event.name === 'Write' && /(?:build[-_]ops\.(?:[cm]?js|py)|ops\.json)$/i.test(path)) {
    const probe = /(?:^|[\/_.-])probe(?:[\/_.-]|$)/i.test(path);
    kinds.push(probe ? 'firstProbeOperations' : 'firstOperations');
  }
  for (const kind of ['apply', 'validate', 'export'])
    if (new RegExp(`(?:deckuse|\\$CLI)\\s+${kind}\\b`).test(command)) kinds.push(kind);
  if (/(?:deckuse|\$CLI)\s+render\b/.test(command) && !command.includes('--preflight'))
    kinds.push('preview');
  if (event.name === 'present_files') kinds.push('attachment');
  return kinds;
}
export function analyzeAgentLog(events) {
  const sorted = events
    .filter((event) => Number.isFinite(event.timestamp))
    .map((event, order) => ({ ...event, order }))
    .sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
  const starts = sorted.filter(isRequest);
  const tasks = starts.map((request, number) => {
    const next = starts[number + 1]?.timestamp ?? Infinity;
    const segment = sorted.filter(
      (event) =>
        event.timestamp >= request.timestamp &&
        event.timestamp < next &&
        !(event.type === 'message' && event.role === 'user' && !isRequest(event)) &&
        !['session-meta', 'file-history-snapshot', 'ai-title'].includes(event.type),
    );
    const results = new Map(
      segment
        .filter((event) => event.type === 'function_call_result')
        .map((event) => [event.callId, event]),
    );
    const calls = segment.filter((event) => event.type === 'function_call');
    const end = Math.max(request.timestamp, ...segment.map((event) => event.timestamp));
    const completionGroups = new Map();
    for (const call of calls) {
      const result = results.get(call.callId);
      if (result)
        completionGroups.set(result.timestamp, (completionGroups.get(result.timestamp) ?? 0) + 1);
    }
    const intervals = calls.map((call) => {
      const result = results.get(call.callId);
      return {
        callId: call.callId,
        tool: call.name,
        startMs: call.timestamp - request.timestamp,
        endMs: result ? result.timestamp - request.timestamp : null,
        attribution:
          result && completionGroups.get(result.timestamp) > 1
            ? 'batch-ambiguous'
            : 'individual-or-unknown',
      };
    });
    const toolMs = intervalUnion(
      intervals.filter((span) => span.endMs !== null).map((span) => [span.startMs, span.endMs]),
    );
    const milestones = Object.fromEntries(
      [
        'installation',
        'contract',
        'firstProbeOperations',
        'firstOperations',
        'apply',
        'validate',
        'export',
        'preview',
        'attachment',
      ].map((name) => [name, null]),
    );
    for (const call of calls)
      for (const kind of milestoneKinds(call)) {
        const result = results.get(call.callId);
        milestones[kind] ??= {
          startedMs: call.timestamp - request.timestamp,
          returnedMs: result ? result.timestamp - request.timestamp : null,
          evidence: 'tool-attempt-only',
        };
      }
    return {
      task: number + 1,
      startedAt: request.timestamp,
      elapsedMs: end - request.timestamp,
      toolUnionMs: toolMs,
      unattributedMs: end - request.timestamp - toolMs,
      toolCalls: calls.length,
      unmatchedCalls: intervals.filter((span) => span.endMs === null).length,
      milestones,
      toolCallIntervals: intervals,
      visualReview: 'unverified',
    };
  });
  return {
    schemaVersion: 1,
    tasks,
    notes: [
      'Tool intervals are merged, not summed. Batched result timestamps do not identify the slow tool.',
      'Unattributed time can include model output, reasoning, host scheduling and incomplete tool traces.',
      'Milestones identify attempts; return status alone cannot prove a validated artifact or visual review. Probe operations are identified by their path names.',
      'Background notifications and summary backfills do not start tasks. No source payloads are included.',
    ],
  };
}
