import { resolve } from 'node:path';
import type { WorkspaceManifest } from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import { writeMetadata } from '@deckflow/deckuse-workspace';
import { buildIndex } from './indexer.js';
import { readIndex } from './workspace.js';
import type { IndexFile } from './types.js';

export async function loadIndex(
  workspace: string,
  archive: OpcArchive,
  manifest: WorkspaceManifest,
  options?: { persist?: boolean },
): Promise<IndexFile> {
  const root = resolve(workspace);
  let index: IndexFile;
  try {
    index = await readIndex(root);
  } catch {
    index = buildIndex(archive, manifest.workspaceId, manifest.revision);
    if (options?.persist) await writeMetadata(root, manifest, index);
    return index;
  }
  if (index.revision !== manifest.revision) {
    index = buildIndex(archive, manifest.workspaceId, manifest.revision);
    if (options?.persist) await writeMetadata(root, manifest, index);
  }
  return index;
}
