/**
 * Status command - show workspace status
 */

import { Workspace } from '../core/workspace.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

export async function statusCommand(workspaceDir: string): Promise<void> {
  try {
    // Check if workspace is initialized
    const isWorkspace = await Workspace.isWorkspace(workspaceDir)

    if (!isWorkspace) {
      logger.error(`Not a DeckUse workspace: ${workspaceDir}`)
      logger.info(
        `Run 'deckuse init <pptx-file>' to initialize a workspace`
      )
      return
    }

    // Load workspace
    const workspace = await Workspace.load(workspaceDir)

    // Get status
    const status = await workspace.getStatus()

    // Display status
    console.log('\n=== Workspace Status ===\n')
    console.log(`Workspace:    ${workspaceDir}`)
    console.log(`Initialized:  ${status.initialized ? 'Yes' : 'No'}`)

    if (status.sourceFile) {
      console.log(`Source file:  ${status.sourceFile}`)
    }

    console.log(`Valid:        ${status.valid ? 'Yes' : 'No'}`)
    console.log(`Has changes:  ${status.hasChanges ? 'Yes' : 'No'}`)

    if (workspace.metadata.initialized) {
      console.log(
        `Created:      ${workspace.metadata.initialized.toISOString()}`
      )
    }

    if (workspace.metadata.lastModified) {
      console.log(
        `Modified:     ${workspace.metadata.lastModified.toISOString()}`
      )
    }

    // Show index stats
    const { slides, shapes, layouts } = workspace.metadata.indexes
    console.log('\n=== Indexes ===\n')
    console.log(`Slides:       ${slides.length}`)
    console.log(`Shapes:       ${shapes.length}`)
    console.log(`Layouts:      ${layouts.length}`)

    // Run validation
    logger.info('\nRunning validation...')
    const validation = await workspace.validate()

    if (validation.valid) {
      logger.success('Workspace is valid')
    } else {
      logger.error('Workspace has errors:')
      for (const error of validation.errors) {
        logger.error(`  - ${error.message} (${error.code})`)
      }
    }

    if (validation.warnings.length > 0) {
      logger.warn('Warnings:')
      for (const warning of validation.warnings) {
        logger.warn(`  - ${warning.message} (${warning.code})`)
      }
    }

    console.log()
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('status', error.message)
    }
    throw error
  }
}
