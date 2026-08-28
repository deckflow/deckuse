import { join, resolve } from 'node:path';

export const sourceDir = (workspace: string) => join(resolve(workspace), 'source');
export const deckuseDir = (workspace: string) => join(resolve(workspace), '.deckuse');
export const manifestPath = (workspace: string) => join(deckuseDir(workspace), 'manifest.json');
export const indexPath = (workspace: string) => join(deckuseDir(workspace), 'index.json');
export const operationsPath = (workspace: string) => join(deckuseDir(workspace), 'operations.jsonl');
export const lockPath = (workspace: string) => join(deckuseDir(workspace), 'write.lock');
export const gitignorePath = (workspace: string) => join(resolve(workspace), '.gitignore');
