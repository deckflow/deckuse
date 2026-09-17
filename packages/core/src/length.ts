/** OOXML English Metric Unit constants (documented for agents). */
export const EMU_PER_INCH = 914_400;
export const EMU_PER_CM = 360_000;
export const EMU_PER_PT = 12_700;
/** CSS px at 96 DPI → EMU (1in = 96px = 914400 EMU). */
export const EMU_PER_PX = 9_525;

/** Default 16:9 slide when presentation.xml has no sldSz. */
export const DEFAULT_SLIDE_WIDTH_EMU = 12_192_000;
export const DEFAULT_SLIDE_HEIGHT_EMU = 6_858_000;

export type LengthAxis = 'x' | 'y' | 'absolute';

export interface LengthContext {
  readonly slideWidthEmu?: number;
  readonly slideHeightEmu?: number;
  /** Which dimension `%` resolves against. Defaults to absolute (uses width). */
  readonly axis?: LengthAxis;
}

export type LengthInput = number | string;

const LENGTH_RE =
  /^\s*(-?\d+(?:\.\d+)?)\s*(px|pt|cm|mm|in|emu|%)?\s*$/i;

/**
 * Parse a length into EMU.
 * - bare numbers are treated as EMU (protocol / OOXML convention)
 * - strings may carry units: px, pt, cm, mm, in, emu, %
 */
export function parseLength(value: LengthInput, context: LengthContext = {}): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid length number: ${String(value)}`);
    return Math.round(value);
  }

  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'auto')
    throw new Error('Length "auto" is only valid for table height; use resolveTableHeight');

  const match = LENGTH_RE.exec(trimmed);
  if (!match) throw new Error(`Invalid length: ${value}`);

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) throw new Error(`Invalid length: ${value}`);
  const unit = (match[2] ?? 'emu').toLowerCase();

  switch (unit) {
    case 'emu':
      return Math.round(amount);
    case 'px':
      return Math.round(amount * EMU_PER_PX);
    case 'pt':
      return Math.round(amount * EMU_PER_PT);
    case 'cm':
      return Math.round(amount * EMU_PER_CM);
    case 'mm':
      return Math.round(amount * (EMU_PER_CM / 10));
    case 'in':
      return Math.round(amount * EMU_PER_INCH);
    case '%': {
      const axis = context.axis ?? 'absolute';
      const basis =
        axis === 'y'
          ? (context.slideHeightEmu ?? DEFAULT_SLIDE_HEIGHT_EMU)
          : (context.slideWidthEmu ?? DEFAULT_SLIDE_WIDTH_EMU);
      return Math.round((amount / 100) * basis);
    }
    default:
      throw new Error(`Unsupported length unit in: ${value}`);
  }
}

export function parseOptionalLength(
  value: LengthInput | undefined,
  context: LengthContext = {},
): number | undefined {
  if (value === undefined) return undefined;
  return parseLength(value, context);
}

/** Zod-friendly union: EMU number or unit string (e.g. "120px", "5%"). */
export const lengthInputDescription =
  'EMU number, or string with unit px|pt|cm|mm|in|emu|% (96 DPI for px; % relative to slide)';
