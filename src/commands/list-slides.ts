/**
 * List slides command
 */

import { openWorkspace } from '../core/open-workspace.js'
import { CommandError } from '../utils/errors.js'

export async function listSlidesCommand(workspaceDir: string): Promise<void> {
  let opened: Awaited<ReturnType<typeof openWorkspace>> | null = null
  try {
    opened = await openWorkspace(workspaceDir)
    const workspace = opened.workspace
    const slides = workspace.getSlides()

    if (slides.length === 0) {
      console.log('No slides found')
      return
    }

    console.log('\n=== Slides ===\n')
    console.log(
      'Index | Slide Ref                     | Layout Ref              | Master Ref                    | Shapes | Content'
    )
    console.log(
      '------|--------------------------------|-------------------------|-------------------------------|--------|------------------'
    )

    const formatRef = (value: unknown, width: number): string => {
      const raw = value ? String(value) : 'unknown'
      if (raw.length <= width) return raw.padEnd(width)
      if (width <= 3) return raw.slice(0, width)
      return raw.slice(0, width - 3) + '...'
    }

    const countShapesDeep = (spTree: unknown): number => {
      if (!Array.isArray(spTree)) return 0

      let count = 0
      for (const node of spTree) {
        count += 1

        // Some PPTX structures represent group-like shapes with nested spTree.
        if (node && typeof node === 'object') {
          const nested = (node as any).spTree
          if (Array.isArray(nested)) {
            count += countShapesDeep(nested)
          }
        }
      }
      return count
    }

    slides.forEach((slide, idx) => {
      const index = String(idx + 1).padStart(5)
      const slideRef = formatRef(slide._ref, 32)
      const layoutRef = formatRef(slide._layoutRef, 22)
      const masterRef = formatRef(slide._masterRef, 29)

      const shapeCountNum = countShapesDeep(slide.spTree)
      const shapeCount = String(shapeCountNum).padStart(6)
      const hasContent = shapeCountNum > 0 ? 'Yes' : 'No'

      console.log(
        `${index} | ${slideRef} | ${layoutRef} | ${masterRef} | ${shapeCount} | ${hasContent}`
      )
    })

    console.log(`\nTotal: ${slides.length} slides\n`)
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('list slides', error.message)
    }
    throw error
  } finally {
    if (opened?.mode === 'pptx') {
      await opened.cleanup().catch(() => {})
    }
  }
}
