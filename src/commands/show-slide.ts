/**
 * Show slide command
 */

import { openWorkspace } from '../core/open-workspace.js'
import { CommandError } from '../utils/errors.js'
// TODO: Import when implementing actual PPTX reading
// import { PptxReader } from '../readers/pptx-reader.js'

export async function showSlideCommand(
  workspaceDir: string,
  slideIndex: number
): Promise<void> {
  let opened: Awaited<ReturnType<typeof openWorkspace>> | null = null
  try {
    opened = await openWorkspace(workspaceDir)
    const workspace = opened.workspace
    const slide = workspace.getSlide(slideIndex)

    if (!slide) {
      console.log(`Slide ${slideIndex} not found`)
      return
    }

    console.log('\n=== Slide Details ===\n')
    console.log(`Index:        ${slideIndex}`)
    console.log(`Layout Ref:   ${slide._layoutRef || 'unknown'}`)
    console.log(`Master Ref:   ${slide._masterRef || 'unknown'}`)
    console.log(`Shapes:       ${slide.spTree?.length ?? 0}`)

    if (slide.clrMapOvr) {
      console.log(`Color Map:    Overridden`)
    }

    if (slide.spTree && slide.spTree.length > 0) {
      console.log('\n=== Shape Tree ===\n')
      console.log('Index | Type      | Properties')
      console.log('------|-----------|------------------')

      slide.spTree.forEach((shape: any, idx: number) => {
        const index = String(idx + 1).padStart(5)
        const type = Object.keys(shape)[0] || 'unknown'
        const hasText = shape[type]?.txBody ? 'Has text' : ''

        console.log(`${index} | ${type.padEnd(9)} | ${hasText}`)
      })
    }

    console.log()
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('show slide', error.message)
    }
    throw error
  } finally {
    if (opened?.mode === 'pptx') {
      await opened.cleanup().catch(() => {})
    }
  }
}
