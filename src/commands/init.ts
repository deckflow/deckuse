/**
 * Init command - initialize a workspace from a PPTX file
 */

import { promises as fs } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { Workspace } from '../core/workspace.js'
import { PptxReader } from '../readers/pptx-reader.js'
import { logger } from '../utils/logger.js'
import { CommandError, FileNotFoundError } from '../utils/errors.js'

const execAsync = promisify(exec)

export interface InitOptions {
  dir?: string
}

export async function initCommand(
  pptxPath: string,
  options: InitOptions = {}
): Promise<void> {
  try {
    logger.info(`Initializing workspace from: ${pptxPath}`)

    // Verify PPTX file exists
    try {
      await fs.access(pptxPath)
    } catch {
      throw new FileNotFoundError(pptxPath)
    }

    // Initialize workspace
    const workspace = await Workspace.init(pptxPath, options.dir)
    logger.success(`Workspace initialized at: ${workspace.workspaceDir}`)

    // Extract PPTX contents
    logger.info('Extracting PPTX contents...')
    await extractPptx(pptxPath, workspace.workspaceDir)
    logger.success('PPTX extracted')

    // Build indexes
    logger.info('Building indexes...')
    await buildIndexes(workspace)
    logger.success('Indexes built')

    logger.success(
      `\nWorkspace ready at: ${workspace.workspaceDir}\nRun 'deckuse status ${workspace.workspaceDir}' to verify`
    )
  } catch (error) {
    if (error instanceof Error) {
      throw new CommandError('init', error.message)
    }
    throw error
  }
}

/**
 * Extract PPTX file to workspace directory
 */
async function extractPptx(
  pptxPath: string,
  workspaceDir: string
): Promise<void> {
  // Use unzip command to extract
  // Note: PPTX files are ZIP archives
  try {
    await execAsync(`unzip -q "${pptxPath}" -d "${workspaceDir}"`)
  } catch (error) {
    throw new Error(`Failed to extract PPTX: ${error}`)
  }
}

/**
 * Build indexes for the workspace
 */
async function buildIndexes(workspace: Workspace): Promise<void> {
  const reader = new PptxReader(workspace.workspaceDir)

  // Read slides and build slide index
  const slides = await reader.readSlides()
  const slideIndex = slides.map((slide, idx) => ({
    index: idx + 1,
    id: slide.id,
    title: slide.title,
    layout: slide.layout,
    path: `ppt/slides/slide${idx + 1}.xml`,
  }))

  await workspace.updateSlideIndex(slideIndex)

  // Read shapes and build shape index
  const allShapes = []
  for (const slide of slides) {
    const shapes = await reader.readShapes(slide.index)
    for (const shape of shapes) {
      allShapes.push({
        slideIndex: slide.index,
        shapeId: shape.id,
        shapeName: shape.name,
        shapeType: shape.type,
        text: shape.text,
      })
    }
  }

  await workspace.updateShapeIndex(allShapes)

  // TODO: Build layout index when reader supports it
  await workspace.updateLayoutIndex([])
}
