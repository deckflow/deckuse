/**
 * Open a DeckUse workspace from either:
 * - an initialized workspace directory, or
 * - a .pptx file path (ephemeral workspace, auto-cleaned up)
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { Workspace } from './workspace.js'
import { PptxReader } from '../readers/pptx-reader.js'
import { FileNotFoundError } from '../utils/errors.js'

const execAsync = promisify(exec)

export type OpenWorkspaceResult =
  | { mode: 'workspace'; workspace: Workspace }
  | {
      mode: 'pptx'
      workspace: Workspace
      sourcePptx: string
      cleanup: () => Promise<void>
    }

function isPptxPath(p: string): boolean {
  return /\.pptx$/i.test(p.trim())
}

async function extractPptx(pptxPath: string, workspaceDir: string): Promise<void> {
  try {
    await execAsync(`unzip -q "${pptxPath}" -d "${workspaceDir}"`)
  } catch (error) {
    throw new Error(`Failed to extract PPTX: ${error}`)
  }
}

async function buildIndexes(workspace: Workspace): Promise<void> {
  const reader = new PptxReader(workspace.workspaceDir)

  if (!workspace.metadata.sourcePptx) {
    throw new Error('Source PPTX path not found in workspace metadata')
  }

  const presentation = await reader.parseFromFile(workspace.metadata.sourcePptx)
  await workspace.updateResults(presentation)
}

/**
 * Open a workspace directory or build an ephemeral workspace from a PPTX file.
 */
export async function openWorkspace(workspaceOrPptx: string): Promise<OpenWorkspaceResult> {
  // Workspace dir path?
  if (await Workspace.isWorkspace(workspaceOrPptx)) {
    return { mode: 'workspace', workspace: await Workspace.load(workspaceOrPptx) }
  }

  // PPTX path?
  if (!isPptxPath(workspaceOrPptx)) {
    // Preserve existing error shape from Workspace.load callers.
    return { mode: 'workspace', workspace: await Workspace.load(workspaceOrPptx) }
  }

  const pptxPath = workspaceOrPptx

  try {
    await fs.access(pptxPath)
  } catch {
    throw new FileNotFoundError(pptxPath)
  }

  const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'deckuse-'))
  const workspaceDir = path.join(tempBase, 'workspace.deck')

  const workspace = await Workspace.init(pptxPath, workspaceDir)
  await extractPptx(pptxPath, workspace.workspaceDir)
  await buildIndexes(workspace)

  const cleanup = async () => {
    await fs.rm(tempBase, { recursive: true, force: true })
  }

  return {
    mode: 'pptx',
    workspace,
    sourcePptx: path.resolve(pptxPath),
    cleanup,
  }
}

