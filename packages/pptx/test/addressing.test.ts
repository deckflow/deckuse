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
    {
      ref: {
        documentId: '/ws',
        elementId: 'layout:/ppt/slideLayouts/slideLayout10.xml',
        path: '/ppt/slideLayouts/slideLayout10.xml',
      },
      kind: 'layout',
      partUri: '/ppt/slideLayouts/slideLayout10.xml',
    },
    {
      ref: {
        documentId: '/ws',
        elementId: 'layout:/ppt/slideLayouts/slideLayout11.xml',
        path: '/ppt/slideLayouts/slideLayout11.xml',
      },
      kind: 'layout',
      partUri: '/ppt/slideLayouts/slideLayout11.xml',
    },
    {
      ref: {
        documentId: '/ws',
        elementId: 'master:/ppt/slideMasters/slideMaster1.xml',
        path: '/ppt/slideMasters/slideMaster1.xml',
      },
      kind: 'master',
      partUri: '/ppt/slideMasters/slideMaster1.xml',
    },
    {
      ref: {
        documentId: '/ws',
        elementId: 'master:/ppt/slideMasters/slideMaster10.xml',
        path: '/ppt/slideMasters/slideMaster10.xml',
      },
      kind: 'master',
      partUri: '/ppt/slideMasters/slideMaster10.xml',
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

  it('resolves layout:slideLayout1 without matching slideLayout10+', () => {
    const index = sampleIndex();
    const resolved = resolveTarget(index, 'layout:slideLayout1');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.target).toBe('layout:slideLayout1');
    expect(resolved.value.item.partUri).toBe('/ppt/slideLayouts/slideLayout1.xml');
  });

  it('resolves layout:2 as 1-based natural-order index', () => {
    const index = sampleIndex();
    // sampleIndex has layout1, layout10, layout11 → natural order: 1, 10, 11
    const resolved = resolveTarget(index, 'layout:2');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.target).toBe('layout:slideLayout10');
  });

  it('resolves layout:slideLayout10 uniquely among numbered layouts', () => {
    const index = sampleIndex();
    const resolved = resolveTarget(index, 'layout:slideLayout10');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.target).toBe('layout:slideLayout10');
  });

  it('resolves master:slideMaster1 without matching slideMaster10', () => {
    const index = sampleIndex();
    const resolved = resolveTarget(index, 'master:slideMaster1');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.target).toBe('master:slideMaster1');
    expect(resolved.value.item.partUri).toBe('/ppt/slideMasters/slideMaster1.xml');
  });
});
