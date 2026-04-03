/**
 * PPTX Writer - wraps @deckflow/pptx-modifier for writing to PPTX files
 */

import type { Modifier, FillStyle } from '@deckflow/pptx-modifier'
import { createModifier } from '@deckflow/pptx-modifier'

function normalizeHexColor(color: string): string {
  const c = color.trim()
  const hex = c.startsWith('#') ? c.slice(1) : c
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid color: ${color}. Expected #RRGGBB or RRGGBB.`)
  }
  return hex.toUpperCase()
}

function parseIdPath(shapeId: string): string[] | null {
  const raw = shapeId.trim()
  if (!raw) return null

  // Accept:
  // - "#1,2,3"
  // - "1,2,3"
  // - "slide:1/#1,2,3" (canonical selector printed by get-text)
  const afterHash = raw.includes('#') ? raw.split('#').pop() ?? raw : raw
  const cleaned = afterHash.trim()
  if (!/^\d+(,\d+)*$/.test(cleaned)) return null
  return cleaned.split(',').map(s => s.trim()).filter(Boolean)
}

function toPptxFontSize(fontSize: number): number {
  // PPTX uses 1/100 pt for sz. Our CLI uses pt (1..400).
  // If a caller already passes large values, assume it's already PPTX units.
  if (fontSize > 1000) return Math.round(fontSize)
  return Math.round(fontSize * 100)
}

export class PptxWriter {
  private readonly workspaceDir: string
  private modifier: Modifier | null = null

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir
  }

  private async getModifier(): Promise<Modifier> {
    if (this.modifier) return this.modifier
    // createModifier supports passing extracted directory path.
    this.modifier = await createModifier(this.workspaceDir)
    return this.modifier
  }

  private async modifyTextOrThrow(
    shapeId: string,
    fn: (modifier: Modifier, idPath: string[]) => Promise<void>
  ): Promise<void> {
    const idPath = parseIdPath(shapeId)
    if (!idPath) {
      // Fallback to Selection Pane name-based APIs are not reliable here because
      // deckuse selectors currently pass ids/paths more often than unique names.
      throw new Error(
        `Unsupported shapeId: "${shapeId}". Expected idPath like "#1,2,3" (or "1,2,3").`
      )
    }
    const modifier = await this.getModifier()
    await fn(modifier, idPath)
  }

  /**
   * Set text for a shape
   */
  async setText(
    slideIndex: number,
    shapeId: string,
    text: string,
    type?: 'slide' | 'slideLayout' | 'slideMaster'
  ): Promise<void> {
    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      await modifier.overwriteApTextByIdPath(idPath, text, slideIndex, { type })
    })
  }

  async setParagraphTextByIdPath(
    slideIndex: number,
    idPath: number[],
    paragraphIndex: number,
    text: string,
    options?: { type?: 'slide' | 'slideLayout' | 'slideMaster' }
  ): Promise<void> {
    const modifier = await this.getModifier()
    const nextIdPath = [...idPath.map(String), String(paragraphIndex)]
    console.log('nextIdPath', nextIdPath, text, slideIndex, options)
    await modifier.overwriteApTextByIdPath(nextIdPath, text, slideIndex, options)
  }

  /**
   * Set font family for a shape
   */
  async setFontFamily(
    slideIndex: number,
    shapeId: string,
    fontFamily: string
  ): Promise<void> {
    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      await modifier.modifyShapeStyleByIdPath(
        idPath,
        { font: fontFamily },
        slideIndex
      )
    })
  }

  /**
   * Set font size for a shape
   */
  async setFontSize(
    slideIndex: number,
    shapeId: string,
    fontSize: number
  ): Promise<void> {
    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      await modifier.modifyShapeStyleByIdPath(
        idPath,
        { fontSize: toPptxFontSize(fontSize) },
        slideIndex
      )
    })
  }

  /**
   * Set font color for a shape
   */
  async setFontColor(
    slideIndex: number,
    shapeId: string,
    color: string
  ): Promise<void> {
    const hex = normalizeHexColor(color)

    const textFill: FillStyle = {
      type: 'solid',
      solid: { type: 'srgb', color: hex },
    }

    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      await modifier.modifyShapeStyleByIdPath(
        idPath,
        { textFill },
        slideIndex
      )
    })
  }

  /**
   * Move a shape by delta
   */
  async moveShape(
    slideIndex: number,
    shapeId: string,
    dx: number,
    dy: number
  ): Promise<void> {
    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      await modifier.modifyShapeStyleByIdPath(
        idPath,
        { left: dx, top: dy },
        slideIndex
      )
    })
  }

  /**
   * Resize a shape
   */
  async resizeShape(
    slideIndex: number,
    shapeId: string,
    width: number,
    height: number
  ): Promise<void> {
    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      console.log('modifyShapeStyleByIdPath', idPath, width, height, slideIndex)
      await modifier.modifyShapeStyleByIdPath(
        idPath,
        { width, height },
        slideIndex
      )
    })
  }

  /**
   * Rotate a shape
   */
  async rotateShape(
    slideIndex: number,
    shapeId: string,
    degrees: number
  ): Promise<void> {
    await this.modifyTextOrThrow(shapeId, async (modifier, idPath) => {
      await modifier.modifyShapeStyleByIdPath(
        idPath,
        { rotation: degrees },
        slideIndex
      )
    })
  }

  async save(): Promise<void> {
    if (this.modifier) {
      await this.modifier.save()
    }
  }
}
