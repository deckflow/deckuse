import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBlankArchive } from '../../src/docx/blank.js';
import { NS } from '../../src/docx/xml.js';
const exec = promisify(execFile);
const cli = async (...args: string[]) =>
  JSON.parse(
    (await exec(process.execPath, [resolve('dist/bin.js'), ...args, '--json'], { timeout: 10000 }))
      .stdout,
  ) as { ok: boolean; data: Record<string, unknown> };
describe('review CLI', () => {
  it('runs comment threads, single proposal apply, views and decisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-review-cli-'));
    try {
      const source = join(root, 'source.docx'),
        workspace = join(root, 'work');
      const archive = buildBlankArchive();
      const doc = archive.readXml('/word/document.xml');
      const p = doc.getElementsByTagNameNS(NS.w, 'p')[0]!;
      const run = doc.createElementNS(NS.w, 'w:r'),
        t = doc.createElementNS(NS.w, 'w:t');
      t.textContent = 'Hello world';
      run.appendChild(t);
      p.appendChild(run);
      archive.writeXml('/word/document.xml', doc);
      await archive.writeFile(source);
      expect((await cli('init', source, workspace)).ok).toBe(true);
      const added = await cli(
        'comments',
        'add',
        '--workspace',
        workspace,
        '--author',
        '{"id":"qa","name":"QA"}',
        '--anchor',
        '{"target":"body/p:1"}',
        '--text',
        'Review',
      );
      expect(added.ok).toBe(true);
      const id = String(added.data['id']);
      const stale = join(root, 'stale.json');
      await writeFile(stale, JSON.stringify({ id, text: 'Stale edit', expectRevision: '1' }));
      await expect(
        cli('comments', 'update', '--input', stale, '--workspace', workspace),
      ).rejects.toThrow();
      const input = join(root, 'reply.json');
      await writeFile(
        input,
        JSON.stringify([
          { type: 'replyComment', id, text: 'Reply', author: { id: 'qa', name: 'QA' } },
        ]),
      );
      expect((await cli('apply', '--input', input, '--workspace', workspace)).ok).toBe(true);
      expect(
        (await cli('comments', 'list', '--workspace', workspace)).data['items'] as unknown[],
      ).toHaveLength(2);
      expect((await cli('comments', 'delete', id, '--thread', '--workspace', workspace)).ok).toBe(
        true,
      );
      await writeFile(
        input,
        JSON.stringify({
          type: 'proposeChanges',
          author: { id: 'qa', name: 'QA' },
          operations: [
            {
              op: 'replaceText',
              start: { target: 'body/p:1', offset: 6 },
              end: { target: 'body/p:1', offset: 11 },
              text: 'everyone',
            },
          ],
        }),
      );
      expect((await cli('apply', '--input', input, '--workspace', workspace)).ok).toBe(true);
      const original = await cli(
        'revisions',
        'view',
        '--view',
        'original',
        '--workspace',
        workspace,
      );
      expect(JSON.stringify(original.data['stories'])).toContain('Hello world');
      const preview = await cli(
        'revisions',
        'preview',
        '--decision',
        'accept',
        '--all',
        '--workspace',
        workspace,
      );
      expect(preview.data['blocked']).toEqual([]);
      expect((await cli('revisions', 'accept', '--all', '--workspace', workspace)).ok).toBe(true);
      expect((await cli('revisions', 'list', '--workspace', workspace)).data['items']).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
});
