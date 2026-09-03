import { describe, expect, it } from 'vitest';
import { parseTargetPath, resolveTarget, targetPathForItem, uidForItem } from '../src/addressing.js';
import type { IndexFile } from '../src/types.js';

const sampleIndex = (): IndexFile => ({
  revision: '1',
  elements: [
    {
      ref: { documentId: '/ws', elementId: 'slide:256', path: '/ppt/slides/slide1.xml' },
      kind: 'slide',
      partUri: '/ppt/slides/slide1.xml',
      slideId: '256',
      name: 'Slide 256',
      location: { slideId: '256', partUri: '/ppt/slides/slide1.xml' },
    },
    {
      ref: {
        documentId: '/ws',
        elementId: '256:2',
        path: '/ppt/slides/slide1.xml#256:2',
      },
      kind: 'textbox',
      partUri: '/ppt/slides/slide1.xml',
      slideId: '256',
      name: 'Title',
      location: { slideId: '256', partUri: '/ppt/slides/slide1.xml', cNvPrId: '2' },
    },
    {
      ref: {
        documentId: '/ws',
        elementId: 'layout:/ppt/slideLayouts/slideLayout1.xml',
        path: '/ppt/slideLayouts/slideLayout1.xml',
      },
      kind: 'layout',
      partUri: '/ppt/slideLayouts/slideLayout1.xml',
    },
  ],
});

describe('addressing', () => {
  it('parses slide/shape target paths', () => {
    const parsed = parseTargetPath('slide:1/shape:2/text');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      slide: 1,
      shapeId: '2',
      focus: 'text',
      kind: 'text',
    });
  });

  it('resolves one-based slide pages to indexed shapes', () => {
    const index = sampleIndex();
    const resolved = resolveTarget(index, 'slide:1/shape:2');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.target).toBe('slide:1/shape:2');
    expect(resolved.value.item.name).toBe('Title');
    expect(resolved.value.uid.startsWith('du:')).toBe(true);
  });

  it('resolves shapes by unique name', () => {
    const index = sampleIndex();
    const resolved = resolveTarget(index, 'slide:1/shape:Title');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.target).toBe('slide:1/shape:2');
  });

  it('builds canonical targets and stable uids', () => {
    const index = sampleIndex();
    const shape = index.elements[1]!;
    expect(targetPathForItem(index, shape)).toBe('slide:1/shape:2');
    expect(uidForItem(shape)).toEqual(uidForItem(shape));
  });
});
