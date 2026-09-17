import { describe, expect, it } from 'vitest';
import { commandJsonSchema, commandSchema, elementRefSchema } from '../src/index.js';
describe('command schema', () => {
  it('parses a versioned mutation', () => {
    const parsed = commandSchema.parse({
      version: '2.0',
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
    expect(Array.isArray(commandJsonSchema.oneOf) || Array.isArray(commandJsonSchema.anyOf)).toBe(
      true,
    );
  });
  it('parses replaceText, undo, and history', () => {
    expect(
      commandSchema.parse({
        version: '2.0',
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
        version: '2.0',
        type: 'undo',
        workspaceId: 'w',
        steps: 2,
      }).steps,
    ).toBe(2);
    expect(
      commandSchema.parse({
        version: '2.0',
        type: 'history',
        workspaceId: 'w',
        limit: 20,
        offset: 5,
      }).limit,
    ).toBe(20);
  });
  it('parses replacePicture with path or base64', () => {
    expect(
      commandSchema.parse({
        version: '2.0',
        type: 'replacePicture',
        workspaceId: 'w',
        transactionId: 'tx',
        ref: { documentId: 'd', elementId: '256:4' },
        path: '/tmp/a.png',
      }).type,
    ).toBe('replacePicture');
    expect(
      commandSchema.parse({
        version: '2.0',
        type: 'replacePicture',
        workspaceId: 'w',
        transactionId: 'tx',
        ref: { documentId: 'd', elementId: '256:4' },
        base64: 'iVBORw0KGgo=',
      }).type,
    ).toBe('replacePicture');
  });
  it('parses Phase 1a get/list/set/target commands', () => {
    expect(
      commandSchema.parse({
        version: '2.0',
        type: 'get',
        workspaceId: 'w',
        target: 'slide:1/shape:2',
        resolve: 'both',
      }).type,
    ).toBe('get');
    expect(
      commandSchema.parse({
        version: '2.0',
        type: 'list',
        workspaceId: 'w',
        resource: 'shapes',
        slide: 1,
      }).type,
    ).toBe('list');
    expect(
      commandSchema.parse({
        version: '2.0',
        type: 'set',
        workspaceId: 'w',
        transactionId: '1',
        target: 'slide:1/shape:2',
        properties: { 'font.size': 42 },
      }).type,
    ).toBe('set');
  });
});
