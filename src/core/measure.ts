import { EMU_PER_PT, EMU_PER_PX } from './length.js';

export interface MeasureTextInput {
  readonly text: string;
  /** Font size in points. */
  readonly fontSize: number;
  readonly bold?: boolean;
  readonly fontFamily?: string;
  /** Optional max width in EMU; when set, text wraps for height estimation. */
  readonly maxWidthEmu?: number;
}

export interface MeasureTextResult {
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly lines: number;
  readonly heuristic: true;
  readonly note: string;
}

const isCjk = (ch: string): boolean => /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(ch);

/** Average glyph width as a fraction of font size (pt → pt). */
const charWidthPt = (ch: string, bold: boolean): number => {
  const factor = bold ? 1.08 : 1;
  if (ch === '\n' || ch === '\r') return 0;
  if (ch === ' ') return 0.33 * factor;
  if (isCjk(ch)) return 1.0 * factor;
  if (/[iIlj1|]/.test(ch)) return 0.28 * factor;
  if (/[mwMW@%]/.test(ch)) return 0.85 * factor;
  return 0.55 * factor;
};

/**
 * Heuristic text measure for agent layout (not a real font rasterizer).
 * Suitable for sizing boxes before render QA; expect ~10–20% error vs PowerPoint.
 */
export function measureText(input: MeasureTextInput): MeasureTextResult {
  const fontSize = input.fontSize;
  if (!(fontSize > 0)) throw new Error('fontSize must be a positive number (pt)');
  const bold = input.bold === true;
  const lineHeightPt = fontSize * 1.2;
  const maxWidthPt =
    input.maxWidthEmu !== undefined && input.maxWidthEmu > 0
      ? input.maxWidthEmu / EMU_PER_PT
      : undefined;

  const paragraphs = input.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let lines = 0;
  let maxLinePt = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines += 1;
      continue;
    }
    if (maxWidthPt === undefined) {
      let widthPt = 0;
      for (const ch of paragraph) widthPt += charWidthPt(ch, bold);
      maxLinePt = Math.max(maxLinePt, widthPt);
      lines += 1;
      continue;
    }
    let lineWidth = 0;
    let lineCount = 1;
    for (const ch of paragraph) {
      const w = charWidthPt(ch, bold);
      if (lineWidth > 0 && lineWidth + w > maxWidthPt) {
        maxLinePt = Math.max(maxLinePt, lineWidth);
        lineWidth = w;
        lineCount += 1;
      } else {
        lineWidth += w;
      }
    }
    maxLinePt = Math.max(maxLinePt, lineWidth);
    lines += lineCount;
  }

  if (lines === 0) lines = 1;
  const widthPt = maxWidthPt !== undefined ? Math.min(maxLinePt, maxWidthPt) : maxLinePt;
  const heightPt = lines * lineHeightPt;
  const widthEmu = Math.max(1, Math.round(widthPt * EMU_PER_PT));
  const heightEmu = Math.max(1, Math.round(heightPt * EMU_PER_PT));

  return {
    widthEmu,
    heightEmu,
    widthPx: Math.round(widthEmu / EMU_PER_PX),
    heightPx: Math.round(heightEmu / EMU_PER_PX),
    lines,
    heuristic: true,
    note: 'Heuristic glyph widths (~10–20% vs PowerPoint). Verify with deckuse render.',
  };
}
