import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../../src/index.js';

describe('process interruption recovery', () => {
  it.each([false, true])('recovers after process termination; committed=%s', async (committed) => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-interrupted-'));
    const base = { version: '2.0', workspaceId: root };
    expect(
      (
        await runCommand({
          ...base,
          type: 'init',
          format: 'pptx',
          source: resolve('assets/default.pptx'),
        })
      ).ok,
    ).toBe(true);
    const original = await readFile(join(root, 'source/ppt/slides/slide1.xml'), 'utf8');
    const transactionUrl = pathToFileURL(resolve('dist/workspace/transaction.js')).href;
    const gitUrl = pathToFileURL(resolve('dist/workspace/git.js')).href;
    const lockUrl = pathToFileURL(resolve('dist/workspace/lock.js')).href;
    const code = `import {withWorkspaceTransaction} from ${JSON.stringify(transactionUrl)};
      import {commitWorkspace} from ${JSON.stringify(gitUrl)};
      import {writeFile,readFile} from 'node:fs/promises';
      const root=${JSON.stringify(root)};
      const {withWriteLock}=await import(${JSON.stringify(lockUrl)});
      await withWriteLock(root,()=>withWorkspaceTransaction(root,async(id,prepare)=>{
        const path=root+'/source/ppt/slides/slide1.xml';
        await writeFile(path,(await readFile(path,'utf8'))+'<!-- interrupted -->');
        if(${committed}) { await prepare(); await commitWorkspace(root,'test\\n\\nDeckuse-Transaction: '+id); }
        process.exit(19);
      }));`;
    expect(
      spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).status,
    ).toBe(19);
    expect((await runCommand({ ...base, type: 'status' })).ok).toBe(true);
    const restored = await readFile(join(root, 'source/ppt/slides/slide1.xml'), 'utf8');
    expect(restored).toBe(committed ? original + '<!-- interrupted -->' : original);
  });
});
