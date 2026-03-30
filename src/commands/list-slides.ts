/**
 * List slides command
 */

import { Workspace } from '../core/workspace.js'
import { CommandError } from '../utils/errors.js'

export async function listSlidesCommand(workspaceDir: string): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    const { slides } = workspace.metadata.indexes

    if (slides.length === 0) {
      console.log('No slides found')
      return
    }

    console.log('\n=== Slides ===\n')
    console.log(
      'Index | ID       | Title                | Layout       | Path'
    )
    console.log(
      '------|----------|----------------------|--------------|-------------'
    )

    for (const slide of slides) {
      const title = (slide.title || '(no title)').padEnd(20).slice(0, 20)
      const layout = slide.layout.padEnd(12).slice(0, 12)
      const id = slide.id.padEnd(8).slice(0, 8)

      console.log(
        `${String(slide.index).padStart(5)} | ${id} | ${title} | ${layout} | ${slide.path}`
      )
    }

    console.log(`\nTotal: ${slides.length} slides\n`)
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('list slides', error.message)
    }
    throw error
  }
}
