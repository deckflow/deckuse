import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildBlankArchive } from '../../src/docx/blank.js';
import { runCommand } from '../../src/index.js';
import { NS } from '../../src/docx/xml.js';

describe('review protocol transactions', () => {
  it('supports dry-run, optimistic conflicts, batch rollback, revisions and undo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckuse-review-transaction-'));
    try {
      const source = join(dir, 'source.docx'),
        workspaceId = join(dir, 'work');
      const a = buildBlankArchive();
      a.setPart(
        '/word/document.xml',
        new TextEncoder().encode(
          `<w:document xmlns:w="${NS.w}"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
        ),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      );
      await a.writeFile(source);
      const base = { version: '2.0', workspaceId };
      expect((await runCommand({ ...base, type: 'init', source, format: 'docx' })).ok).toBe(true);
      const add = {
        ...base,
        type: 'addComment',
        transactionId: '1',
        expectRevision: '1',
        author: { id: 'alice', name: 'Alice' },
        text: 'Review',
        anchor: {
          target: 'body/p:1',
          start: { target: 'body/p:1', offset: 6 },
          end: { target: 'body/p:1', offset: 11 },
        },
      };
      const sourceBytes = await readFile(join(workspaceId, 'source/word/document.xml'));
      expect((await runCommand({ ...add, dryRun: true })).ok).toBe(true);
      expect(await readFile(join(workspaceId, 'source/word/document.xml'))).toEqual(sourceBytes);
      const added = await runCommand(add);
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      const id = String((added.value as Record<string, unknown>)['id']);
      expect((await runCommand(add)).ok).toBe(false);
      const before = await readFile(join(workspaceId, 'source/word/comments.xml'));
      const batch = await runCommand({
        ...base,
        type: 'batch',
        transactionId: '2',
        expectRevision: '2',
        commands: [
          {
            ...base,
            type: 'updateComment',
            transactionId: '2',
            expectRevision: '2',
            id,
            text: 'must roll back',
          },
          {
            ...base,
            type: 'replyComment',
            transactionId: '2',
            expectRevision: '2',
            id: 'missing',
            text: 'fail',
            author: { id: 'alice', name: 'Alice' },
          },
        ],
      });
      expect(batch.ok).toBe(false);
      expect(await readFile(join(workspaceId, 'source/word/comments.xml'))).toEqual(before);
      expect(
        (
          await runCommand({
            ...base,
            type: 'replaceText',
            transactionId: '2',
            find: 'Hello',
            replace: 'Hi',
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await runCommand({
            ...base,
            type: 'replaceText',
            transactionId: '3',
            find: 'world',
            replace: 'everyone',
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await runCommand({
            ...base,
            type: 'deleteComment',
            transactionId: '3',
            expectRevision: '3',
            id,
            thread: true,
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await runCommand({
            ...base,
            type: 'proposeChanges',
            transactionId: '4',
            expectRevision: '4',
            author: { id: 'alice', name: 'Alice' },
            operations: [
              {
                op: 'replaceText',
                start: { target: 'body/p:1', offset: 0 },
                end: { target: 'body/p:1', offset: 2 },
                text: 'Hey',
              },
            ],
          })
        ).ok,
      ).toBe(true);
      const inventory = await runCommand({ ...base, type: 'listRevisions' });
      expect(inventory.ok).toBe(true);
      expect(
        (
          await runCommand({
            ...base,
            type: 'acceptRevisions',
            transactionId: '5',
            expectRevision: '5',
            all: true,
          })
        ).ok,
      ).toBe(true);
      expect((await runCommand({ ...base, type: 'undo', steps: 1 })).ok).toBe(true);
      const restored = await runCommand({ ...base, type: 'listRevisions' });
      expect(restored.ok).toBe(true);
      if (restored.ok)
        expect((restored.value as { items: unknown[] }).items.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
