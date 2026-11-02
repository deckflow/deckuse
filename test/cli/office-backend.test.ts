import { describe, expect, it } from 'vitest';
import { runOfficeProcess } from '../../src/office-backend.js';
describe('Office process lifecycle', () => {
  it('surfaces missing backends and process failures', async () => {
    await expect(runOfficeProcess('/not-a-deckuse-renderer', [])).rejects.toThrow();
    await expect(
      runOfficeProcess(process.execPath, [
        '-e',
        'process.stderr.write("broken-renderer");process.exit(7)',
      ]),
    ).rejects.toThrow('broken-renderer');
  });
  it('terminates stuck process groups and rejects rather than returning success', async () => {
    await expect(
      runOfficeProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], 100),
    ).rejects.toThrow('timed out');
  });
});
