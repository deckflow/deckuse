/**
 * Selector parsing and resolution system
 * Supports syntax like:
 * - slide:3
 * - slide:3/title
 * - shape[type=textbox]
 * - text[contains('Revenue')]
 */

import { Selector, ResolvedTarget, WorkspaceMetadata } from './types.js'
import { InvalidSelectorError, SelectorNotFoundError } from '../utils/errors.js'

export class SelectorParser {
  /**
   * Parse a selector string into a Selector object
   */
  static parse(selectorStr: string): Selector {
    const trimmed = selectorStr.trim()

    // Handle path-based selectors: slide:3/title or slide:3/text[contains('X')]
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/')
      const base = parts[0]!
      const pathParts = parts.slice(1)

      const baseSelector = this.parseSimple(base)

      // Parse each path component - could be a string or a selector
      const path = pathParts.map(part => {
        // Check if this path component is a filter selector
        // Matches: text[contains('X')], shape[type=textbox], etc.
        if (/^(slide|shape|text|layout)\[.+\]$/.test(part)) {
          return this.parseSimple(part) // Parse as a Selector
        }
        return part // Keep as plain string
      })

      return {
        ...baseSelector,
        path,
        raw: selectorStr,
      }
    }

    return this.parseSimple(trimmed)
  }

  /**
   * Parse a simple selector (no path)
   */
  private static parseSimple(selector: string): Selector {
    // Handle indexed selectors: slide:3, shape:2
    const indexMatch = selector.match(/^(slide|shape|text|layout):(\d+)$/)
    if (indexMatch && indexMatch[1] && indexMatch[2]) {
      const type = indexMatch[1]
      const indexStr = indexMatch[2]
      return {
        type: type as Selector['type'],
        index: parseInt(indexStr, 10),
        raw: selector,
      }
    }

    // Handle filtered selectors: shape[type=textbox]
    const filterMatch = selector.match(/^(slide|shape|text|layout)\[(.+?)\]$/)
    if (filterMatch && filterMatch[1] && filterMatch[2]) {
      const type = filterMatch[1]
      const filterStr = filterMatch[2]
      const filters = this.parseFilters(filterStr)
      return {
        type: type as Selector['type'],
        filters,
        raw: selector,
      }
    }

    // Handle type-only selectors: slide, shape
    if (['slide', 'shape', 'text', 'layout'].includes(selector)) {
      return {
        type: selector as Selector['type'],
        raw: selector,
      }
    }

    throw new InvalidSelectorError(
      selector,
      'Expected format: type:index, type[filter], or type:index/path'
    )
  }

  /**
   * Parse filter expressions
   */
  private static parseFilters(filterStr: string): Record<string, string> {
    const filters: Record<string, string> = {}

    // Handle simple key=value filters
    const kvMatch = filterStr.match(/^(\w+)=(.+)$/)
    if (kvMatch && kvMatch[1] && kvMatch[2]) {
      const key = kvMatch[1]
      const value = kvMatch[2]
      filters[key] = value.replace(/^["']|["']$/g, '')
      return filters
    }

    // Handle function-style filters: contains('text')
    const funcMatch = filterStr.match(/^(\w+)\((.+?)\)$/)
    if (funcMatch && funcMatch[1] && funcMatch[2]) {
      const func = funcMatch[1]
      const arg = funcMatch[2]
      filters[func] = arg.replace(/^["']|["']$/g, '')
      return filters
    }

    throw new InvalidSelectorError(
      filterStr,
      'Invalid filter syntax'
    )
  }
}

export class SelectorResolver {
  /**
   * Resolve a selector to actual targets in the workspace
   */
  static async resolve(
    selector: Selector,
    metadata: WorkspaceMetadata,
    workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    switch (selector.type) {
      case 'slide':
        return this.resolveSlide(selector, metadata, workspaceDir)
      case 'shape':
        return this.resolveShape(selector, metadata, workspaceDir)
      case 'text':
        return this.resolveText(selector, metadata, workspaceDir)
      case 'layout':
        return this.resolveLayout(selector, metadata, workspaceDir)
      default:
        throw new InvalidSelectorError(
          selector.raw,
          `Unknown selector type: ${selector.type}`
        )
    }
  }

  /**
   * Resolve slide selector
   */
  private static async resolveSlide(
    selector: Selector,
    metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    const slides = metadata.results?.slides ?? []

    // Index-based selection
    if (selector.index !== undefined) {
      const slide = slides[selector.index - 1]
      if (!slide) {
        throw new SelectorNotFoundError(selector.raw)
      }

      // Handle path if present (e.g., slide:3/title or slide:3/text[contains('X')])
      if (selector.path && selector.path.length > 0) {
        return this.resolvePath(slide, selector.index, selector.path, metadata, _workspaceDir)
      }

      return [
        {
          slide: selector.index,
          element: slide,
        },
      ]
    }

    // Filter-based selection
    if (selector.filters) {
      const filtered = slides.filter((slide: any) => {
        for (const [key, value] of Object.entries(selector.filters!)) {
          if (key === 'layout' && slide._layoutRef !== value) {
            return false
          }
          // Add more filter logic as needed
        }
        return true
      })

      return filtered.map((slide: any) => ({
        slide: slides.indexOf(slide) + 1,
        element: slide,
      }))
    }

    // Return all slides if no index or filter
    return slides.map((slide: any, idx: number) => ({
      slide: idx + 1,
      element: slide,
    }))
  }

  /**
   * Resolve shape selector
   */
  private static async resolveShape(
    selector: Selector,
    metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    const slides = metadata.results?.slides ?? []
    const results: ResolvedTarget[] = []

    // Filter-based selection
    if (selector.filters) {
      slides.forEach((slide: any, slideIdx: number) => {
        const shapes = slide.spTree ?? []
        shapes.forEach((shape: any) => {
          // Match filters
          for (const [key, value] of Object.entries(selector.filters!)) {
            if (key === 'type' && shape.type === value) {
              results.push({
                slide: slideIdx + 1,
                element: shape,
              })
            }
          }
        })
      })
    }

    return results
  }

  /**
   * Resolve text selector
   */
  private static async resolveText(
    selector: Selector,
    metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    const slides = metadata.results?.slides ?? []
    const results: ResolvedTarget[] = []

    // Filter-based selection (e.g., text[contains('Revenue')])
    if (selector.filters) {
      slides.forEach((slide: any, slideIdx: number) => {
        const shapes = slide.spTree ?? []
        shapes.forEach((shape: any) => {
          if (shape?.txBody) {
            // Extract text from textBody
            const text = this.extractTextFromBody(shape.txBody)

            for (const [key, value] of Object.entries(selector.filters!)) {
              if (key === 'contains' && text.includes(value)) {
                results.push({
                  slide: slideIdx + 1,
                  element: shape,
                  metadata: { text },
                })
              }
            }
          }
        })
      })
    }

    return results
  }

  /**
   * Extract plain text from text body structure
   */
  private static extractTextFromBody(textBody: any): string {
    if (!textBody) {
      return ''
    }

    const texts: string[] = []

    // Handle @deckflow/presentation format (children-based)
    if (textBody.children) {
      const paragraphs = Array.isArray(textBody.children) ? textBody.children : [textBody.children]

      for (const paragraph of paragraphs) {
        if (!paragraph || !paragraph.children) continue

        const paragraphTexts: string[] = []
        const runs = Array.isArray(paragraph.children) ? paragraph.children : [paragraph.children]

        for (const run of runs) {
          if (run && run.t) {
            paragraphTexts.push(run.t)
          }
        }

        if (paragraphTexts.length > 0) {
          texts.push(paragraphTexts.join(''))
        }
      }

      return texts.join('\n')
    }

    // Handle standard PPTX format (p/r based) as fallback
    if (textBody.p) {
      const paragraphs = Array.isArray(textBody.p) ? textBody.p : [textBody.p]

      for (const paragraph of paragraphs) {
        if (!paragraph) continue

        const paragraphTexts: string[] = []

        if (paragraph.r) {
          const runs = Array.isArray(paragraph.r) ? paragraph.r : [paragraph.r]

          for (const run of runs) {
            if (run && run.t) {
              paragraphTexts.push(run.t)
            }
          }
        }

        if (paragraphTexts.length > 0) {
          texts.push(paragraphTexts.join(''))
        }
      }

      return texts.join('\n')
    }

    return ''
  }

  /**
   * Resolve layout selector
   */
  private static async resolveLayout(
    selector: Selector,
    metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    // Extract all slide layouts from slide masters
    const slideMasters = metadata.results?.slideMasters ?? []
    const layouts: any[] = []
    for (const master of slideMasters) {
      if (master?.slideLayouts && Array.isArray(master.slideLayouts)) {
        layouts.push(...master.slideLayouts)
      }
    }

    // Index-based selection
    if (selector.index !== undefined) {
      const layout = layouts[selector.index - 1]
      if (!layout) {
        throw new SelectorNotFoundError(selector.raw)
      }

      return [
        {
          slide: -1, // Layout is not slide-specific
          element: layout,
        },
      ]
    }

    // Filter-based selection
    if (selector.filters) {
      const filtered = layouts.filter((layout: any) => {
        for (const [key, value] of Object.entries(selector.filters!)) {
          if (key === 'path' && layout.path !== value) {
            return false
          }
        }
        return true
      })

      return filtered.map((layout: any) => ({
        slide: -1,
        element: layout,
      }))
    }

    return layouts.map((layout: any) => ({
      slide: -1,
      element: layout,
    }))
  }

  /**
   * Resolve path components within a scope (e.g., slide:1/text[contains('X')])
   */
  private static async resolvePath(
    baseElement: any,
    slideIndex: number,
    path: (string | Selector)[],
    _metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    // Process each path component
    for (const component of path) {
      if (typeof component === 'string') {
        // Simple string path
        // Special case: 'text' means all text in this slide
        if (component === 'text') {
          return this.resolveTextInSlide(
            { type: 'text', raw: 'text' },
            baseElement,
            slideIndex
          )
        }

        // For other string paths (e.g., 'title', 'body'), return with path metadata
        return [
          {
            slide: slideIndex,
            element: baseElement,
            metadata: { path: [component] },
          },
        ]
      } else {
        // It's a nested Selector - apply it within the current scope
        if (component.type === 'text') {
          return this.resolveTextInSlide(component, baseElement, slideIndex)
        } else if (component.type === 'shape') {
          return this.resolveShapeInSlide(component, baseElement, slideIndex)
        }
      }
    }

    // Fallback: return base element
    return [{ slide: slideIndex, element: baseElement }]
  }

  /**
   * Resolve text selector within a specific slide
   */
  private static resolveTextInSlide(
    selector: Selector,
    slide: any,
    slideIndex: number
  ): ResolvedTarget[] {
    const results: ResolvedTarget[] = []
    const shapes = slide.spTree ?? []

    if (!selector.filters) {
      // No filters - return all text shapes
      shapes.forEach((shape: any) => {
        if (shape?.txBody) {
          const text = this.extractTextFromBody(shape.txBody)
          results.push({
            slide: slideIndex,
            element: shape,
            metadata: { text },
          })
        }
      })
      return results
    }

    // Apply filters
    shapes.forEach((shape: any) => {
      if (shape?.txBody) {
        const text = this.extractTextFromBody(shape.txBody)

        for (const [key, value] of Object.entries(selector.filters!)) {
          if (key === 'contains' && text.includes(value)) {
            results.push({
              slide: slideIndex,
              element: shape,
              metadata: { text },
            })
          }
        }
      }
    })

    return results
  }

  /**
   * Resolve shape selector within a specific slide
   */
  private static resolveShapeInSlide(
    selector: Selector,
    slide: any,
    slideIndex: number
  ): ResolvedTarget[] {
    const results: ResolvedTarget[] = []
    const shapes = slide.spTree ?? []

    if (!selector.filters) {
      // No filters - return all shapes
      return shapes.map((shape: any) => ({
        slide: slideIndex,
        element: shape,
      }))
    }

    // Apply filters
    shapes.forEach((shape: any) => {
      for (const [key, value] of Object.entries(selector.filters!)) {
        if (key === 'type' && shape.type === value) {
          results.push({
            slide: slideIndex,
            element: shape,
          })
        }
      }
    })

    return results
  }
}
