/**
 * Replace text command - global find and replace
 */

import { Workspace } from '../core/workspace.js'
import { PptxWriter } from '../writers/pptx-writer.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

export interface ReplaceTextOptions {
  slide?: number
  regex?: boolean
}

export async function replaceTextCommand(
  workspaceDir: string,
  searchText: string,
  replaceText: string,
  options: ReplaceTextOptions = {}
): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const writer = new PptxWriter(workspace.workspaceDir)

    logger.info(
      `Replacing "${searchText}" with "${replaceText}"${
        options.slide ? ` in slide ${options.slide}` : ' globally'
      }`
    )

    // Perform replacement
    const count = await writer.replaceText(searchText, replaceText, {
      slideIndex: options.slide,
      regex: options.regex,
    })

    // Save changes
    await writer.save()

    // Update workspace metadata
    await workspace.updateMetadata({
      lastModified: new Date(),
    })

    logger.success(`\nReplaced ${count} occurrence(s)`)
    logger.info(
      `Run 'deckuse commit ${workspaceDir}' to build the PPTX file`
    )
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('replace text', error.message)
    }
    throw error
  }
}
