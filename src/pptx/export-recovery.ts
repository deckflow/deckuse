import { createHash, randomUUID } from 'node:crypto';
import { link, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const candidateSchema = z.object({
  state: z.literal('validated-staging'),
  invocationId: z.uuid(),
  output: z.string(),
  revision: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const exportDigest = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export async function recoverPptxExport(envelope: unknown, destination: string) {
  const report = z
    .object({
      ok: z.literal(false),
      command: z.literal('deckuse export'),
      error: z.object({ details: candidateSchema }),
    })
    .parse(envelope);
  const candidate = report.error.details;
  const stage = `${candidate.output}.${candidate.invocationId}.tmp`;
  const bytes = await readFile(stage);
  if (exportDigest(bytes) !== candidate.sha256)
    throw new Error('Export staging checksum changed; recover from the workspace instead');
  const output = resolve(destination);
  const temp = `${output}.${randomUUID()}.recovering`;
  const file = await open(temp, 'wx');
  let warning: string | undefined;
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temp, output);
  } finally {
    await rm(temp, { force: true }).catch((error: unknown) => {
      warning = `Could not remove recovery staging file ${temp}: ${String(error)}`;
    });
  }
  return {
    output,
    revision: candidate.revision,
    invocationId: candidate.invocationId,
    sha256: candidate.sha256,
    state: 'committed',
    ...(warning ? { warnings: [warning] } : {}),
  };
}
