import { describe, expect, it } from 'vitest';
import { commandJsonSchema, commandSchema, elementRefSchema } from '../src/index.js';
describe('command schema', () => {
  it('parses a versioned mutation', () => {
    const parsed = commandSchema.parse({
      version: '1.0',
      type: 'setText',
      workspaceId: 'w',
      transactionId: 'tx',
      ref: { documentId: 'd', elementId: 'e' },
      text: 'hello',
    });
    expect(parsed.type).toBe('setText');
  });
  it('rejects unknown versions and fields', () => {
    expect(() =>
      commandSchema.parse({ version: '2.0', type: 'validate', workspaceId: 'w', extra: true }),
    ).toThrow();
  });
  it('requires a stable or path reference', () => {
    expect(elementRefSchema.safeParse({ documentId: 'd' }).success).toBe(false);
  });
  it('exposes draft 2020-12 JSON schema', () => {
    expect(commandJsonSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(commandJsonSchema.oneOf).toHaveLength(14);
  });
  it('parses replaceText and commit overwrite', () => {
    expect(
      commandSchema.parse({
        version: '1.0',
        type: 'replaceText',
        workspaceId: 'w',
        transactionId: 'tx',
        find: '季度',
        replace: 'Quarter',
        regex: false,
        selector: 'hasText=true',
      }).type,
    ).toBe('replaceText');
    expect(
      commandSchema.parse({
        version: '1.0',
        type: 'commit',
        workspaceId: 'w',
        transactionId: 'tx',
        overwrite: true,
      }).overwrite,
    ).toBe(true);
  });
});
