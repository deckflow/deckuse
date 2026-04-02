/**
 * Get text command
 */

import { Workspace } from '../core/workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxReader } from '../readers/pptx-reader.js'
import { CommandError } from '../utils/errors.js'

function findIdPathInSpTree(
  spTree: unknown,
  target: unknown,
  prefix: number[] = []
): number[] | null {
  if (!Array.isArray(spTree)) return null

  for (const node of spTree) {
    if (!node || typeof node !== 'object') continue

    const nodeIdRaw = (node as any).id
    const nodeId = typeof nodeIdRaw === 'number' ? nodeIdRaw : undefined
    const nextPrefix = nodeId !== undefined ? [...prefix, nodeId] : [...prefix]

    if (node === target) {
      return nextPrefix.length > 0 ? nextPrefix : null
    }

    const nested = (node as any).spTree
    const nestedPath = findIdPathInSpTree(nested, target, nextPrefix)
    if (nestedPath) return nestedPath
  }

  return null
}

function formatCanonicalIdPathSelector(slideIndex: number, idPath: number[]): string {
  return `slide:${slideIndex}/#${idPath.join(',')}`
}

export async function getTextCommand(
  workspaceDir: string,
  selectorStr: string
): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const reader = new PptxReader(workspace.workspaceDir)

    // Parse selector
    const selector = SelectorParser.parse(selectorStr)

    // Resolve targets
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
      // Get text based on target type
      let text: string | null = null
      let canonicalSelector: string | null = null

      // First check if selector already extracted text (e.g., from text[contains('X')])
      if (target.metadata?.text && typeof target.metadata.text === 'string') {
        text = target.metadata.text
        const slide = workspace.getSlide(target.slide)
        const idPath = slide
          ? findIdPathInSpTree(slide.spTree, target.element)
          : null
        canonicalSelector =
          idPath && idPath.length > 0
            ? formatCanonicalIdPathSelector(target.slide, idPath)
            : null

        console.log(`Slide ${target.slide}:`)
      } else if (target.shapeId) {
        // Get text from specific shape
        text = await reader.readText(target.slide, target.shapeId)
        console.log(
          `Slide ${target.slide}, Shape ${target.shapeId}:`
        )
      } else if (target.slide >= 0) {
        // Get all text from slide
        text = await reader.readSlideText(target.slide)
        console.log(`Slide ${target.slide}:`)
      }

      if (canonicalSelector) {
        console.log(`Selector: ${canonicalSelector}`)
      }

      if (text) {
        console.log(text)
        console.log()
      } else {
        console.log('(no text)')
        console.log()
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('get text', error.message)
    }
    throw error
  }
}
