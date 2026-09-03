export {
  sourceDir,
  deckuseDir,
  manifestPath,
  indexPath,
  operationsPath,
  monitorDir,
  lockPath,
  gitignorePath,
} from './paths.js';
export { revision, nextRevision, isIntegerRevision, INITIAL_REVISION } from './revision.js';
export {
  hasWorkspaceGitRepo,
  ensureGitignore,
  initGitRepo,
  commitWorkspace,
  resetGit,
  operationCommitMessage,
} from './git.js';
export { acquireWriteLock, withWriteLock } from './lock.js';
export {
  type OperationRecord,
  readOperations,
  writeOperations,
  appendOperationCommit,
  readHistory,
} from './operations.js';
export { readManifest, writeMetadata } from './metadata.js';
