import { describe, expect, it } from 'vitest';
import { measureText } from '../src/measure.js';

describe('measureText', () => {
  it('estimates width and height for latin text', () => {
    const result = measureText({ text: 'Hello', fontSize: 12 });
    expect(result.heuristic).toBe(true);
    expect(result.lines).toBe(1);
    expect(result.widthEmu).toBeGreaterThan(1);
    expect(result.heightEmu).toBeGreaterThan(1);
  });

  it('wraps when maxWidthEmu is set', () => {
    const result = measureText({
      text: 'abcdefghijklmnopqrstuvwxyz',
      fontSize: 12,
      maxWidthEmu: 50_000,
    });
    expect(result.lines).toBeGreaterThan(1);
  });
});
