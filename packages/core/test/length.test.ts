import { describe, expect, it } from 'vitest';
import {
  EMU_PER_CM,
  EMU_PER_INCH,
  EMU_PER_PT,
  EMU_PER_PX,
  parseLength,
} from '../src/length.js';

describe('parseLength', () => {
  it('treats bare numbers as EMU', () => {
    expect(parseLength(914400)).toBe(914400);
    expect(parseLength('914400')).toBe(914400);
  });

  it('converts common units', () => {
    expect(parseLength('1in')).toBe(EMU_PER_INCH);
    expect(parseLength('1cm')).toBe(EMU_PER_CM);
    expect(parseLength('12pt')).toBe(12 * EMU_PER_PT);
    expect(parseLength('10px')).toBe(10 * EMU_PER_PX);
    expect(parseLength('10 mm')).toBe(Math.round(EMU_PER_CM));
  });

  it('resolves percent against slide size', () => {
    expect(parseLength('50%', { slideWidthEmu: 1000, axis: 'x' })).toBe(500);
    expect(parseLength('25%', { slideHeightEmu: 800, axis: 'y' })).toBe(200);
  });

  it('rejects invalid input', () => {
    expect(() => parseLength('nope')).toThrow(/Invalid length/);
    expect(() => parseLength('auto')).toThrow(/auto/);
  });
});
