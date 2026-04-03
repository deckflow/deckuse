/**
 * Set font size command
 */

import { Workspace } from '../core/workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxWriter } from '../writers/pptx-writer.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

export async function setFontSizeCommand(
  workspaceDir: string,
  selectorStr: string,
  fontSize: number
): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const writer = new PptxWriter(workspace.workspaceDir)

    // Validate font size
    if (fontSize <= 0 || fontSize > 400) {
      throw new Error('Font size must be between 1 and 400')
    }

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

    // Set font size for each target
    let updatedCount = 0
    for (const target of targets) {
      if (target.shapeId) {
        await writer.setFontSize(target.slide, target.shapeId, fontSize)
        logger.info(
          `Updated font size in slide ${target.slide}, shape ${target.shapeId}`
        )
        updatedCount++
      } else {
        logger.warn(
          `Skipping target at slide ${target.slide} (no shape ID)`
        )
      }
    }

    await writer.save()

    await workspace.updateMetadata({
      lastModified: new Date(),
    })

    logger.success(
      `\nFont size set to ${fontSize} in ${updatedCount} shape(s)`
    )
    logger.info(
      `Run 'deckuse commit ${workspaceDir}' to build the PPTX file`
    )
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('set font-size', error.message)
    }
    throw error
  }
}
