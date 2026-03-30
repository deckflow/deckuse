/**
 * Set text command - replace text in a shape
 */

import { Workspace } from '../core/workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxWriter } from '../writers/pptx-writer.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

export async function setTextCommand(
  workspaceDir: string,
  selectorStr: string,
  text: string
): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const writer = new PptxWriter(workspace.workspaceDir)

    // Parse selector
    const selector = SelectorParser.parse(selectorStr)

    // Resolve targets
    const targets = await SelectorResolver.resolve(
      selector,
      workspace.metadata,
      workspace.workspaceDir
    )

    if (targets.length === 0) {
      logger.error(`No matches found for selector: ${selectorStr}`)
      return
    }

    logger.info(`Found ${targets.length} target(s)`)

    // Set text for each target
    let updatedCount = 0
    for (const target of targets) {
      if (target.shapeId) {
        await writer.setText(target.slide, target.shapeId, text)
        logger.info(
          `Updated text in slide ${target.slide}, shape ${target.shapeId}`
        )
        updatedCount++
      } else {
        logger.warn(
          `Skipping target at slide ${target.slide} (no shape ID)`
        )
      }
    }

    // Save changes
    await writer.save()

    // Update workspace metadata
    await workspace.updateMetadata({
      lastModified: new Date(),
    })

    logger.success(
      `\nText updated in ${updatedCount} shape(s)`
    )
    logger.info(
      `Run 'deckuse commit ${workspaceDir}' to build the PPTX file`
    )
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('set text', error.message)
    }
    throw error
  }
}
