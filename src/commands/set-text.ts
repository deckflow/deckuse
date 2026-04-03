/**
 * Set text command - replace text in matched paragraphs
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

    const selector = SelectorParser.parse(selectorStr)
    const paragraphs = await SelectorResolver.resolveParagraphs(
      selector,
      workspace.metadata,
      workspace.workspaceDir
    )
    console.log('paragraphs', JSON.stringify(paragraphs, null, 2));

    if (paragraphs.length === 0) {
      logger.error(`No matches found for selector: ${selectorStr}`)
      return
    }

    logger.info(`Found ${paragraphs.length} paragraph(s)`)

    let updatedCount = 0
    for (const p of paragraphs) {
      await writer.setParagraphTextByIdPath(
        p.pageIndex,
        p.idPath,
        p.paragraphIndex,
        text,
        { type: p.pageType }
      )
      updatedCount++
    }

    await writer.save()
    await workspace.updateMetadata({ lastModified: new Date() })

    logger.success(`\nText updated in ${updatedCount} paragraph(s)`)
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
