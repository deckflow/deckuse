/**
 * Get text command
 */

import { Workspace } from '../core/workspace.js'
import { SelectorParser, SelectorResolver } from '../core/selector.js'
import { PptxReader } from '../readers/pptx-reader.js'
import { CommandError } from '../utils/errors.js'

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

      if (target.shapeId) {
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
