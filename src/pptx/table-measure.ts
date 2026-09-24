import { EMU_PER_PT, measureText } from '../core/index.js';

/** Default DrawingML cell left/right margin (~0.1"). */
export const TABLE_CELL_PAD_X_EMU = 91_440;
/** Default DrawingML cell top/bottom margin (~0.05"). */
export const TABLE_CELL_PAD_Y_EMU = 45_720;
/** Matches table cell border width written by `tableXml` (`w="6350"`). */
export const TABLE_CELL_BORDER_EMU = 6_350;
/** Extra headroom on total table height (~8%). */
export const TABLE_HEIGHT_SAFETY = 1.08;
/** Default body font for generated tables. */
export const TABLE_DEFAULT_FONT_PT = 11;

export interface TableMeasureInput {
  readonly rows: readonly (readonly string[])[];
  /** Full table width in EMU (sum of column widths). */
  readonly widthEmu: number;
  readonly fontPt?: number;
  /** When true, row 0 uses bold glyph widths. */
  readonly headerBold?: boolean;
}

export interface TableMeasureResult {
  readonly rowHeightsEmu: readonly number[];
  readonly totalHeightEmu: number;
  readonly colWidthEmu: number;
  readonly cols: number;
}

/** Minimum single-line row height including vertical padding and borders. */
export const estimateTableRowHeightEmu = (fontPt = TABLE_DEFAULT_FONT_PT): number => {
  const textH = Math.round(fontPt * 1.2 * EMU_PER_PT);
  return textH + TABLE_CELL_PAD_Y_EMU * 2 + TABLE_CELL_BORDER_EMU * 2;
};

/** Empty-cell fallback: rowCount × single-line row height (no wrap). */
export const estimateTableHeightEmu = (rowCount: number, fontPt = TABLE_DEFAULT_FONT_PT): number =>
  Math.round(Math.max(1, rowCount) * estimateTableRowHeightEmu(fontPt) * TABLE_HEIGHT_SAFETY);

/**
 * Per-row height from content wrap heuristics (measureText + cell padding/borders).
 */
export function measureTableLayout(input: TableMeasureInput): TableMeasureResult {
  const fontPt = input.fontPt ?? TABLE_DEFAULT_FONT_PT;
  const rows = input.rows.length > 0 ? input.rows : [['']];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const widthEmu = Math.max(1, input.widthEmu);
  const colWidthEmu = Math.floor(widthEmu / cols);
  const contentWidthEmu = Math.max(
    1,
    colWidthEmu - TABLE_CELL_PAD_X_EMU * 2 - TABLE_CELL_BORDER_EMU * 2,
  );
  const headerBold = input.headerBold !== false;
  const minRow = estimateTableRowHeightEmu(fontPt);

  const rowHeightsEmu = rows.map((row, rowIndex) => {
    let maxCell = minRow;
    for (let c = 0; c < cols; c++) {
      const raw = row[c];
      const text = typeof raw === 'string' ? raw : '';
      const measured = measureText({
        text: text.length > 0 ? text : ' ',
        fontSize: fontPt,
        bold: headerBold && rowIndex === 0,
        maxWidthEmu: contentWidthEmu,
      });
      const cellH = measured.heightEmu + TABLE_CELL_PAD_Y_EMU * 2 + TABLE_CELL_BORDER_EMU * 2;
      maxCell = Math.max(maxCell, cellH);
    }
    return maxCell;
  });

  const rawTotal = rowHeightsEmu.reduce((sum, h) => sum + h, 0);
  const totalHeightEmu = Math.max(1, Math.round(rawTotal * TABLE_HEIGHT_SAFETY));
  // Distribute safety into the last row so Σ rowH ≈ frame height.
  if (rowHeightsEmu.length > 0) {
    const sum = rowHeightsEmu.reduce((a, b) => a + b, 0);
    const delta = totalHeightEmu - sum;
    if (delta !== 0) {
      const last = rowHeightsEmu[rowHeightsEmu.length - 1]!;
      rowHeightsEmu[rowHeightsEmu.length - 1] = Math.max(1, last + delta);
    }
  }

  return { rowHeightsEmu, totalHeightEmu, colWidthEmu, cols };
}

export const tableHeightMayClipDiagnostic = (input: {
  estimatedEmu: number;
  givenEmu: number;
  target?: string;
}): {
  severity: 'warning';
  code: 'TABLE_HEIGHT_MAY_CLIP';
  message: string;
  details: Record<string, unknown>;
} => ({
  severity: 'warning',
  code: 'TABLE_HEIGHT_MAY_CLIP',
  message: `Table height ${String(input.givenEmu)} EMU is below estimated content height ${String(input.estimatedEmu)} EMU; bottom rows may clip`,
  details: {
    estimatedEmu: input.estimatedEmu,
    givenEmu: input.givenEmu,
    ...(input.target !== undefined ? { target: input.target } : {}),
  },
});
