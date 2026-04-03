/**
 * Commit command - build workspace back into a PPTX file
 */

import { promises as fs } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { Workspace } from '../core/workspace.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

const execAsync = promisify(exec)

export interface CommitOptions {
  output?: string
}

export async function commitCommand(
  workspaceDir: string,
  options: CommitOptions = {}
): Promise<void> {
  try {
    logger.info(`Committing workspace: ${workspaceDir}`)

    // Load workspace
    const workspace = await Workspace.load(workspaceDir)

    // Validate workspace
    logger.info('Validating workspace...')
    const validation = await workspace.validate()

    if (!validation.valid) {
      logger.error('Workspace has errors:')
      for (const error of validation.errors) {
        logger.error(`  - ${error.message} (${error.code})`)
      }
      throw new Error('Cannot commit invalid workspace')
    }

    if (validation.warnings.length > 0) {
      logger.warn('Warnings:')
      for (const warning of validation.warnings) {
        logger.warn(`  - ${warning.message} (${warning.code})`)
      }
    }

    // Determine output path
    const outputPath =
      options.output ||
      (workspace.metadata.sourcePptx
        ? workspace.metadata.sourcePptx.replace(/\.pptx$/i, '_out.pptx')
        : path.join(path.dirname(workspaceDir), 'output.pptx'))

    // Build PPTX
    logger.info(`Building PPTX: ${outputPath}`)
    await buildPptx(workspaceDir, outputPath)

    logger.success(`\nPPTX created: ${outputPath}`)
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('commit', error.message)
    }
    throw error
  }
}

/**
 * Build PPTX file from workspace directory
 */
async function buildPptx(
  workspaceDir: string,
  outputPath: string
): Promise<void> {
  const absCwd = path.resolve(workspaceDir)
  const absOutput = path.resolve(outputPath)

  const tempDir = path.join(absCwd, '.deckuse', 'temp')
  await fs.mkdir(tempDir, { recursive: true })

  try {
    const excludePattern = '.deckuse/*'

    await execAsync(
      `cd "${absCwd}" && zip -r -q -X "${absOutput}" . -x "${excludePattern}"`,
      { cwd: absCwd }
    )
  } catch (error) {
    throw new Error(`Failed to build PPTX: ${error}`)
  }
}
