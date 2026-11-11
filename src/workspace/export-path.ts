import { realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

/** Resolve existing directory aliases, including ancestors of new destinations. */
async function resolveDirectory(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw cause;
    return join(await resolveDirectory(dirname(path)), basename(path));
  }
}

export async function isWorkspaceExportPathProtected(workspace: string, output: string) {
  const root = await realpath(workspace);
  const destination = join(await resolveDirectory(dirname(resolve(output))), basename(output));
  for (const [base, path] of [
    [resolve(workspace), resolve(output)],
    [root, destination],
  ] as const) {
    const local = relative(base, path);
    if (!local) return true;
    const first = local.split(sep)[0]?.toLowerCase() ?? '';
    if (
      ['.deckuse', '.git', '.gitignore', '.deckuse-trash', '.deckuse-init.lock', 'source'].includes(
        first,
      ) ||
      /^package\.(?:pptx|docx)$/.test(first)
    )
      return true;
  }
  return false;
}
