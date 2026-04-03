/**
 * Replace text command - global find and replace
 */

import { Workspace } from '../core/workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxWriter } from '../writers/pptx-writer.js'
import { logger } from '../utils/logger.js'
import { CommandError } from '../utils/errors.js'
import { countOccurrences, pickQuoteForContains } from '../utils/pptx-text.js'

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

    const slideCount = workspace.getSlideCount()
    const slideIndices = options.slide
      ? [options.slide]
      : Array.from({ length: slideCount }, (_, i) => i + 1)

    let replacedCount = 0
    let updatedParagraphCount = 0

    let regex: RegExp | null = null
    if (options.regex) {
      try {
        regex = new RegExp(searchText, 'g')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        throw new CommandError('replace text', `Invalid regex: ${message}`)
      }
    }

    for (const slideIndex of slideIndices) {
      const quote = pickQuoteForContains(searchText)
      const canUseContains = !options.regex && !!searchText && quote !== null

      const selectorStr = canUseContains
        ? `slide:${slideIndex}/text[contains(${quote}${searchText}${quote})]`
        : `slide:${slideIndex}/text`

      const selector = SelectorParser.parse(selectorStr)
      const paragraphs = await SelectorResolver.resolveParagraphs(
        selector,
        workspace.metadata,
        workspace.workspaceDir
      )

      for (const p of paragraphs) {
        let newText: string

        if (options.regex && regex) {
          const matches = p.text.match(regex)
          if (!matches || matches.length === 0) continue
          replacedCount += matches.length
          newText = p.text.replace(regex, replaceText)
        } else {
          if (!searchText) continue
          const occ = countOccurrences(p.text, searchText)
          if (occ === 0) continue
          replacedCount += occ
          newText = p.text.split(searchText).join(replaceText)
        }

        await writer.setParagraphTextByIdPath(
          p.pageIndex,
          p.idPath,
          p.paragraphIndex,
          newText,
          { type: p.pageType }
        )
        updatedParagraphCount++
      }
    }

    await writer.save()
    await workspace.updateMetadata({ lastModified: new Date() })

    logger.success(`\nReplaced ${replacedCount} occurrence(s)`)
    logger.info(`Updated ${updatedParagraphCount} paragraph(s)`)
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
