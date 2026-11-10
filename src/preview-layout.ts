export interface PreviewFinding {
  code: string;
  shapeId: string;
  otherShapeId?: string;
  sample: string;
  value: number;
  unit: 'lines' | 'px' | 'px²';
  action: string;
}

/** This function executes in the preview page. Rectangles are CSS pixels. */
export function measurePreviewLayout(paragraphs: Element[]): {
  findings: PreviewFinding[];
  shapeIds: string[];
} {
  interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
  const findings: PreviewFinding[] = [];
  const shapeIds = new Set<string>();
  const skipped = new Set<string>();
  const textLines: { shapeId: string; sample: string; box: Rect }[] = [];
  for (const paragraph of paragraphs.slice(0, 400)) {
    const shape = paragraph.closest('[data-shape-id]');
    const shapeId = shape?.getAttribute('data-shape-id');
    const text = paragraph.textContent;
    if (!shape || !shapeId || !text.trim()) continue;
    if (text.length > 400 || paragraph.querySelector('br')) {
      skipped.add(shapeId);
      continue;
    }
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const chars: { char: string; offset: number; box: DOMRect }[] = [];
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? '';
      for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (!char?.trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) chars.push({ char, offset: offset + i, box });
      }
      offset += value.length;
    }
    const lines: {
      center: number;
      height: number;
      sample: string;
      box: Rect;
      offsets: number[];
    }[] = [];
    for (const { char, box, offset: charOffset } of chars) {
      const center = (box.top + box.bottom) / 2;
      const line = lines.find(
        (item) => Math.abs(item.center - center) < Math.min(item.height, box.height) * 0.45,
      );
      if (!line) {
        lines.push({
          center,
          height: box.height,
          sample: char,
          offsets: [charOffset],
          box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        });
        continue;
      }
      line.sample += char;
      line.offsets.push(charOffset);
      line.box.left = Math.min(line.box.left, box.left);
      line.box.top = Math.min(line.box.top, box.top);
      line.box.right = Math.max(line.box.right, box.right);
      line.box.bottom = Math.max(line.box.bottom, box.bottom);
    }
    if (lines.length) shapeIds.add(shapeId);
    for (const line of lines)
      textLines.push({
        shapeId,
        sample: text.slice(line.offsets[0], (line.offsets.at(-1) ?? 0) + 1).slice(0, 80),
        box: line.box,
      });
    const sample = text.trim().slice(0, 80);
    const add = (code: string, value: number, unit: PreviewFinding['unit'], action: string) => {
      findings.push({ code, shapeId, sample, value, unit, action });
    };
    if (lines.length > 1) {
      const finalLine = lines.at(-1);
      if (finalLine && /^\p{Script=Han}[。！？]?$/u.test(finalLine.sample))
        add(
          'CJK_ORPHAN_LINE',
          lines.length,
          'lines',
          'Widen the text box or rephrase to avoid the final orphan character.',
        );
      const tokenSplit = [...text.matchAll(/[A-Za-z0-9]+(?:-[\p{L}\p{N}]+)*/gu)].some((match) => {
        const start = match.index;
        const end = start + match[0].length;
        return lines.filter((line) => line.offsets.some((i) => i >= start && i < end)).length > 1;
      });
      if (tokenSplit)
        add(
          /^[\p{L}\p{N}-]{1,6}$/u.test(text.trim()) ? 'SHORT_LABEL_WRAP' : 'TEXT_TOKEN_WRAP',
          lines.length,
          'lines',
          'Increase the available width or adjust font size to keep the token together.',
        );
    }
    const bounds = shape.getBoundingClientRect();
    const excess = Math.max(
      0,
      ...lines.map(({ box }) =>
        Math.max(
          bounds.left - box.left,
          box.right - bounds.right,
          bounds.top - box.top,
          box.bottom - bounds.bottom,
        ),
      ),
    );
    if (excess > 3)
      add(
        'RENDERED_TEXT_OUTSIDE_SHAPE',
        Math.round(excess),
        'px',
        'Inspect the shape bounds and increase the text area if the excess is unintended.',
      );
  }
  const seen = new Set<string>();
  textLines.sort((a, b) => a.box.top - b.box.top);
  for (const [i, a] of textLines.entries()) {
    for (let j = i + 1; j < textLines.length; j++) {
      const b = textLines[j];
      if (!b || b.box.top >= a.box.bottom - 2) break;
      if (a.shapeId === b.shapeId) continue;
      const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (width <= 2 || height <= 2 || width * height < 12) continue;
      const key = [a.shapeId, b.shapeId].sort().join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        code: 'RENDERED_TEXT_OVERLAP',
        shapeId: a.shapeId,
        otherShapeId: b.shapeId,
        sample: a.sample,
        value: Math.round(width * height),
        unit: 'px²',
        action: 'Move one text shape or adjust its content to clear the intersection.',
      });
    }
  }
  for (const paragraph of paragraphs.slice(400)) {
    const id = paragraph.closest('[data-shape-id]')?.getAttribute('data-shape-id');
    if (id) skipped.add(id);
  }
  return { findings, shapeIds: [...shapeIds].filter((id) => !skipped.has(id)) };
}
