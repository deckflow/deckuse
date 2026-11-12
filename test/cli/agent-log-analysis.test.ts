import { expect, it } from 'vitest';
// Synthetic events only: real user traces must not enter the repository.
const { analyzeAgentLog, intervalUnion } = await import('../../scripts/agent-log-analysis.mjs');
it('merges concurrent intervals and excludes summary/notification task boundaries', () => {
  const user = (timestamp: number, text: string) => ({
    timestamp,
    type: 'message',
    role: 'user',
    content: [{ text }],
  });
  const result = analyzeAgentLog([
    user(1000, '<user_query>Make a deck</user_query>'),
    {
      timestamp: 2000,
      type: 'function_call',
      callId: 'a',
      name: 'Bash',
      arguments: '{"command":"deckuse apply --input ops.json"}',
    },
    { timestamp: 3000, type: 'function_call', callId: 'b', name: 'Read', arguments: '{}' },
    { timestamp: 6000, type: 'function_call_result', callId: 'a' },
    { timestamp: 6000, type: 'function_call_result', callId: 'b' },
    user(7000, '<task-notification>Done</task-notification>'),
    { timestamp: 8000, type: 'message', role: 'assistant', content: [{ text: 'Ready' }] },
    user(9000, '<cb_summary><user_query>Old request</user_query></cb_summary>'),
    user(10000, '<user_query>Next deck</user_query>'),
    { timestamp: 12000, type: 'function_call', callId: 'c', name: 'Read', arguments: '{}' },
  ]);
  expect(result.tasks).toHaveLength(2);
  expect(result.tasks[0]).toMatchObject({
    elapsedMs: 7000,
    toolUnionMs: 4000,
    unattributedMs: 3000,
    toolCalls: 2,
  });
  expect(
    result.tasks[0].toolCallIntervals.every((span: any) => span.attribution === 'batch-ambiguous'),
  ).toBe(true);
  expect(result.tasks[0].milestones.apply.evidence).toBe('tool-attempt-only');
  expect(result.tasks[1].unmatchedCalls).toBe(1);
  expect(JSON.stringify(result)).not.toContain('Make a deck');
  expect(
    intervalUnion([
      [0, 10],
      [3, 8],
      [12, 15],
    ]),
  ).toBe(13);
});

it('keeps probe and formal operations milestones separate', () => {
  const result = analyzeAgentLog([
    {
      timestamp: 100,
      type: 'message',
      role: 'user',
      content: [{ text: '<user_query>Make a deck</user_query>' }],
    },
    ...['./probe-ops.json', './job/build_ops.py'].map((file_path, i) => ({
      timestamp: 200 + i * 100,
      type: 'function_call',
      callId: String(i),
      name: 'Write',
      arguments: JSON.stringify({ file_path }),
    })),
  ]);
  expect(result.tasks[0].milestones.firstProbeOperations.startedMs).toBe(100);
  expect(result.tasks[0].milestones.firstOperations.startedMs).toBe(200);
  expect(JSON.stringify(result)).not.toContain('probe-ops.json');
});
