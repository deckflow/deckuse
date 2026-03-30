/**
 * Show slide command
 */

import { Workspace } from '../core/workspace.js'
import { CommandError } from '../utils/errors.js'
// TODO: Import when implementing actual PPTX reading
// import { PptxReader } from '../readers/pptx-reader.js'

export async function showSlideCommand(
  workspaceDir: string,
  slideIndex: number
): Promise<void> {
  try {
    const workspace = await Workspace.load(workspaceDir)
    // TODO: Use reader when implementing actual PPTX reading
    // const reader = new PptxReader(workspace.workspaceDir)

    // Find slide in index
    const slide = workspace.metadata.indexes.slides.find(
      (s) => s.index === slideIndex
    )

    if (!slide) {
      console.log(`Slide ${slideIndex} not found`)
      return
    }

    // Get shapes for this slide
    const shapes = workspace.metadata.indexes.shapes.filter(
      (s) => s.slideIndex === slideIndex
    )

    console.log('\n=== Slide Details ===\n')
    console.log(`Index:        ${slide.index}`)
    console.log(`ID:           ${slide.id}`)
    console.log(`Title:        ${slide.title || '(no title)'}`)
    console.log(`Layout:       ${slide.layout}`)
    console.log(`Path:         ${slide.path}`)
    console.log(`Shape count:  ${shapes.length}`)

    if (shapes.length > 0) {
      console.log('\n=== Shapes ===\n')
      console.log('ID       | Name                 | Type       | Text')
      console.log('---------|----------------------|------------|-------------')

      for (const shape of shapes) {
        const id = shape.shapeId.padEnd(8).slice(0, 8)
        const name = shape.shapeName.padEnd(20).slice(0, 20)
        const type = shape.shapeType.padEnd(10).slice(0, 10)
        const text = shape.text
          ? shape.text.slice(0, 30) + (shape.text.length > 30 ? '...' : '')
          : ''

        console.log(`${id} | ${name} | ${type} | ${text}`)
      }
    }

    console.log()
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('show slide', error.message)
    }
    throw error
  }
}
