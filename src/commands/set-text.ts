/**
 * Set text command - replace text in matched paragraphs
 */

import { openWorkspace } from '../core/open-workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxWriter } from '../writers/pptx-writer.js'
import { commitCommand } from './commit.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'

export interface SetTextOptions {
  output?: string
}

export async function setTextCommand(
  workspaceDir: string,
  selectorStr: string,
  text: string,
  options: SetTextOptions
): Promise<void> {
  let opened: Awaited<ReturnType<typeof openWorkspace>> | null = null
  try {
    opened = await openWorkspace(workspaceDir)
    const workspace = opened.workspace
    const writer = new PptxWriter(workspace.workspaceDir)

    const selector = SelectorParser.parse(selectorStr)
    const paragraphs = await SelectorResolver.resolveParagraphs(
      selector,
      workspace.metadata,
      workspace.workspaceDir
    )

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

    if (opened.mode === 'pptx') {
      if (!options.output) {
        throw new Error('When workspace is a .pptx file, -o/--output is required')
      }
      await commitCommand(workspace.workspaceDir, { output: options.output })
      logger.success(`Output PPTX: ${options.output}`)
    } else if (options.output) {
      await commitCommand(workspace.workspaceDir, { output: options.output })
      logger.success(`Output PPTX: ${options.output}`)
    } else {
      logger.info(`Run 'deckuse commit ${workspaceDir}' to build the PPTX file`)
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('set text', error.message)
    }
    throw error
  } finally {
    if (opened?.mode === 'pptx') {
      await opened.cleanup().catch(() => {})
    }
  }
}
