import { describe, expect, it } from 'vitest';
import { unescapeCliText } from '../src/cli-text.js';

describe('unescapeCliText', () => {
  it('turns \\n and \\t into real characters', () => {
    expect(unescapeCliText('a\\nb')).toBe('a\nb');
    expect(unescapeCliText('a\\tb')).toBe('a\tb');
  });

  it('keeps escaped backslash-n as literal \\n after one pass', () => {
    expect(unescapeCliText('a\\\\nb')).toBe('a\\nb');
  });
});
