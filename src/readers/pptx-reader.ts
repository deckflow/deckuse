/**
 * PPTX Reader - wraps @deckflow/presentation for reading PPTX files
 */

import { promises as fs } from 'fs'
import { Presentation } from '@deckflow/presentation'
import { SlideInfo, ShapeInfo } from '../core/types.js'

export class PptxReader {
  private presentation: Presentation | null = null
  private readonly workspaceDir: string

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir
  }

  /**
   * Load the presentation from workspace
   */
  private async loadPresentation(): Promise<Presentation> {
    if (this.presentation) {
      return this.presentation
    }

    // Create presentation instance
    this.presentation = new Presentation()

    // TODO: Implement loading from workspace directory
    // The workspace directory contains extracted PPTX files
    // We may need to:
    // 1. Zip them back to create a buffer, or
    // 2. Load directly from the XML files (if supported by @deckflow/presentation)
    // For now, this is a placeholder
    console.log('Workspace directory:', this.workspaceDir)

    return this.presentation
  }

  /**
   * Parse presentation from PPTX file
   * This is used during init to get the full presentation structure
   */
  async parseFromFile(pptxPath: string): Promise<any> {
    const presentation = new Presentation()

    // Load PPTX file into buffer
    const buffer = await fs.readFile(pptxPath)
    await presentation.loadAsync(buffer)

    // IMPORTANT: Load in correct order!
    // 1. Load slide masters first
    await presentation.loadSlideMasterAsync()

    // 2. Load slide layouts (depends on masters)
    await presentation.loadSlideLayoutAsync()

    // 3. Load slides last (depends on layouts)
    await presentation.loadSlideAsync()

    // Convert presentation to JSON - it contains slides, slideMasters (with slideLayouts), etc.
    return presentation.toJSON()
  }

  /**
   * Read all slides from the presentation
   */
  async readSlides(): Promise<SlideInfo[]> {
    const presentation = await this.loadPresentation()
    const slideCount = presentation.getSlideCount()

    const slides: SlideInfo[] = []
    for (let i = 0; i < slideCount; i++) {
      const slide = presentation.slides[i]
      if (!slide) continue

      slides.push({
        index: i + 1,
        id: `slide${i + 1}`,
        title: this.extractSlideTitle(slide),
        layout: 'unknown', // TODO: Extract layout info
        shapeCount: 0, // TODO: Count shapes
        hasNotes: false, // TODO: Check for notes
      })
    }

    return slides
  }

  /**
   * Extract title from slide (heuristic)
   */
  private extractSlideTitle(_slide: any): string | undefined {
    // TODO: Implement title extraction logic
    // This would involve looking for title placeholders in the slide
    return undefined
  }

  /**
   * Read slide by index
   */
  async readSlide(index: number): Promise<SlideInfo | null> {
    const presentation = await this.loadPresentation()
    const slide = presentation.slides[index - 1]

    if (!slide) return null

    return {
      index,
      id: `slide${index}`,
      title: this.extractSlideTitle(slide),
      layout: 'unknown',
      shapeCount: 0,
      hasNotes: false,
    }
  }

  /**
   * Read shapes from a slide
   */
  async readShapes(_slideIndex: number): Promise<ShapeInfo[]> {
    // TODO: Implement shape extraction
    return []
  }

  /**
   * Read text from a shape
   */
  async readText(_slideIndex: number, _shapeId: string): Promise<string | null> {
    // TODO: Implement text extraction
    return null
  }

  /**
   * Read all text from a slide
   */
  async readSlideText(_slideIndex: number): Promise<string> {
    // TODO: Implement slide text extraction
    return ''
  }

  /**
   * Get presentation metadata
   */
  async getMetadata(): Promise<{
    slideCount: number
    title?: string
    author?: string
  }> {
    const presentation = await this.loadPresentation()

    return {
      slideCount: presentation.getSlideCount(),
      // TODO: Extract title and author from presentation properties
      title: undefined,
      author: undefined,
    }
  }
}
