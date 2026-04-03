/**
 * Get text command
 */

import { Workspace } from '../core/workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxReader } from '../readers/pptx-reader.js'
import { CommandError } from '../utils/errors.js'
import { formatCanonicalIdPathSelector, formatParagraphSelector } from '../utils/pptx-text.js'

export async function getTextCommand(
  workspaceDir: string,
  selectorStr: string
): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const reader = new PptxReader(workspace.workspaceDir)

    const selector = SelectorParser.parse(selectorStr)

    const paragraphs = await SelectorResolver.resolveParagraphs(
      selector,
      workspace.metadata,
      workspace.workspaceDir
    )

    if (paragraphs.length === 0) {
      // Fallback: try shape-level resolve for slides without txBody
      const targets = await SelectorResolver.resolve(
        selector,
        workspace.metadata,
        workspace.workspaceDir
      )

      if (targets.length === 0) {
        console.log(`No matches found for selector: ${selectorStr}`)
        return
      }

      console.log('\n=== Text Content ===\n')
      for (const target of targets) {
        if (target.shapeId) {
          const text = await reader.readText(target.slide, target.shapeId)
          console.log(`Slide ${target.slide}, Shape ${target.shapeId}:`)
          console.log(text ?? '(no text)')
          console.log()
        } else if (target.slide >= 0) {
          const text = await reader.readSlideText(target.slide)
          console.log(`Slide ${target.slide}:`)
          console.log(text ?? '(no text)')
          console.log()
        }
      }
      return
    }

    console.log('\n=== Text Content ===\n')

    // Group by shape (pageType + pageIndex + idPath)
    const shapeKey = (p: typeof paragraphs[number]) =>
      `${p.pageType}:${p.pageIndex}/#${p.idPath.join(',')}`

    let lastKey = ''
    for (const p of paragraphs) {
      const key = shapeKey(p)
      if (key !== lastKey) {
        lastKey = key
        const canonicalSelector = formatCanonicalIdPathSelector(p.pageIndex, p.idPath)
        const typeLabel = p.pageType === 'slide'
          ? `Slide ${p.pageIndex}`
          : p.pageType === 'slideLayout'
            ? `Layout ${p.pageIndex}`
            : `Master ${p.pageIndex}`
        console.log(`${typeLabel}:`)
        console.log(`Selector: ${canonicalSelector}`)
      }

      const canonicalSelector = formatCanonicalIdPathSelector(p.pageIndex, p.idPath)
      console.log(`P${p.paragraphIndex}: ${formatParagraphSelector(canonicalSelector, p.paragraphIndex)}`)
      console.log(p.text.length > 0 ? p.text : '(empty)')
      console.log()
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('get text', error.message)
    }
    throw error
  }
}
