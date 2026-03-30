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

    // Handle path-based selectors: slide:3/title
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/')
      const base = parts[0]!
      const path = parts.slice(1)

      const baseSelector = this.parseSimple(base)
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
    const { indexes } = metadata

    // Index-based selection
    if (selector.index !== undefined) {
      const slide = indexes.slides.find((s) => s.index === selector.index)
      if (!slide) {
        throw new SelectorNotFoundError(selector.raw)
      }

      // Handle path if present (e.g., slide:3/title)
      if (selector.path && selector.path.length > 0) {
        return [
          {
            slide: slide.index,
            element: null, // Will be populated by command handler
            metadata: {
              path: selector.path,
              slideId: slide.id,
            },
          },
        ]
      }

      return [
        {
          slide: slide.index,
          element: null,
          metadata: {
            slideId: slide.id,
          },
        },
      ]
    }

    // Filter-based selection
    if (selector.filters) {
      const filtered = indexes.slides.filter((slide) => {
        for (const [key, value] of Object.entries(selector.filters!)) {
          if (key === 'layout' && slide.layout !== value) {
            return false
          }
          if (key === 'title' && slide.title !== value) {
            return false
          }
        }
        return true
      })

      return filtered.map((slide) => ({
        slide: slide.index,
        element: null,
        metadata: {
          slideId: slide.id,
        },
      }))
    }

    // Return all slides if no index or filter
    return indexes.slides.map((slide) => ({
      slide: slide.index,
      element: null,
      metadata: {
        slideId: slide.id,
      },
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
    const { indexes } = metadata

    // Filter-based selection
    if (selector.filters) {
      const filtered = indexes.shapes.filter((shape) => {
        for (const [key, value] of Object.entries(selector.filters!)) {
          if (key === 'type' && shape.shapeType !== value) {
            return false
          }
          if (key === 'name' && shape.shapeName !== value) {
            return false
          }
        }
        return true
      })

      return filtered.map((shape) => ({
        slide: shape.slideIndex,
        shapeId: shape.shapeId,
        element: null,
        metadata: {
          shapeName: shape.shapeName,
          shapeType: shape.shapeType,
        },
      }))
    }

    return []
  }

  /**
   * Resolve text selector
   */
  private static async resolveText(
    selector: Selector,
    metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    const { indexes } = metadata

    // Filter-based selection (e.g., text[contains('Revenue')])
    if (selector.filters) {
      const results: ResolvedTarget[] = []

      for (const shape of indexes.shapes) {
        if (!shape.text) continue

        for (const [key, value] of Object.entries(selector.filters)) {
          if (key === 'contains' && shape.text.includes(value)) {
            results.push({
              slide: shape.slideIndex,
              shapeId: shape.shapeId,
              element: null,
              metadata: {
                text: shape.text,
                shapeName: shape.shapeName,
              },
            })
          }
        }
      }

      return results
    }

    return []
  }

  /**
   * Resolve layout selector
   */
  private static async resolveLayout(
    selector: Selector,
    metadata: WorkspaceMetadata,
    _workspaceDir: string
  ): Promise<ResolvedTarget[]> {
    const { indexes } = metadata

    // Index-based selection
    if (selector.index !== undefined) {
      const layout = indexes.layouts[selector.index]
      if (!layout) {
        throw new SelectorNotFoundError(selector.raw)
      }

      return [
        {
          slide: -1, // Layout is not slide-specific
          element: null,
          metadata: {
            layoutId: layout.id,
            layoutName: layout.name,
          },
        },
      ]
    }

    // Filter-based selection
    if (selector.filters) {
      const filtered = indexes.layouts.filter((layout) => {
        for (const [key, value] of Object.entries(selector.filters!)) {
          if (key === 'name' && layout.name !== value) {
            return false
          }
        }
        return true
      })

      return filtered.map((layout) => ({
        slide: -1,
        element: null,
        metadata: {
          layoutId: layout.id,
          layoutName: layout.name,
        },
      }))
    }

    return indexes.layouts.map((layout) => ({
      slide: -1,
      element: null,
      metadata: {
        layoutId: layout.id,
        layoutName: layout.name,
      },
    }))
  }
}
