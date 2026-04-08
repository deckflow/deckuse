/**
 * Status command - show workspace status
 */

import { openWorkspace } from '../core/open-workspace.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

export async function statusCommand(workspaceDir: string): Promise<void> {
  let opened: Awaited<ReturnType<typeof openWorkspace>> | null = null
  try {
    opened = await openWorkspace(workspaceDir)
    const workspace = opened.workspace

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

    // Show data stats from results
    const slides = workspace.getSlides()
    const masters = workspace.getSlideMasters()
    const layouts = workspace.getSlideLayouts()

    console.log('\n=== Content ===\n')
    console.log(`Slides:       ${slides.length}`)
    console.log(`Masters:      ${masters.length}`)
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
  } finally {
    if (opened?.mode === 'pptx') {
      await opened.cleanup().catch(() => {})
    }
  }
}
