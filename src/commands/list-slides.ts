/**
 * List slides command
 */

import { Workspace } from '../core/workspace.js'
import { CommandError } from '../utils/errors.js'

export async function listSlidesCommand(workspaceDir: string): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const slides = workspace.getSlides()

    if (slides.length === 0) {
      console.log('No slides found')
      return
    }

    console.log('\n=== Slides ===\n')
    console.log('Index | Layout Ref        | Shapes | Content')
    console.log('------|-------------------|--------|------------------')

    slides.forEach((slide, idx) => {
      const index = String(idx + 1).padStart(5)
      const layoutRef = (slide._layoutRef || 'unknown').padEnd(17).slice(0, 17)
      const shapeCount = String(slide.spTree?.length ?? 0).padStart(6)
      const hasContent = slide.spTree?.length > 0 ? 'Yes' : 'No'

      console.log(`${index} | ${layoutRef} | ${shapeCount} | ${hasContent}`)
    })

    console.log(`\nTotal: ${slides.length} slides\n`)
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('list slides', error.message)
    }
    throw error
  }
}
