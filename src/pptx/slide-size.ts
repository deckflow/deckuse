import { requireDefined } from '../required.js';
import {
  DEFAULT_SLIDE_HEIGHT_EMU,
  DEFAULT_SLIDE_WIDTH_EMU,
  type LengthContext,
  parseLength,
  type LengthInput,
} from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import { attr, first } from './xml.js';

export interface SlideSize {
  readonly widthEmu: number;
  readonly heightEmu: number;
}

export function readSlideSize(archive: OpcArchive): SlideSize {
  try {
    const presentation = archive.readXml('/ppt/presentation.xml');
    const sldSz = first(presentation, 'sldSz');
    const cx = attr(sldSz, 'cx');
    const cy = attr(sldSz, 'cy');
    if (cx && cy) {
      const widthEmu = Number(cx);
      const heightEmu = Number(cy);
      if (Number.isFinite(widthEmu) && Number.isFinite(heightEmu) && widthEmu > 0 && heightEmu > 0)
        return { widthEmu, heightEmu };
    }
  } catch {
    // fall through to defaults
  }
  return { widthEmu: DEFAULT_SLIDE_WIDTH_EMU, heightEmu: DEFAULT_SLIDE_HEIGHT_EMU };
}

export function lengthContextFor(
  archive: OpcArchive,
  axis: LengthContext['axis'] = 'absolute',
): LengthContext {
  const size = readSlideSize(archive);
  return {
    slideWidthEmu: size.widthEmu,
    slideHeightEmu: size.heightEmu,
    axis,
  };
}

/** Only blank templates can be sized; imported content must never be stretched. */
export function setBlankPageSize(
  archive: OpcArchive,
  size: { width: LengthInput; height: LengthInput },
): SlideSize {
  const doc = archive.readXml('/ppt/presentation.xml');
  const lengths = [size.width, size.height].map((value) => {
    if (typeof value === 'string' && value.includes('%'))
      throw new Error('pageSize does not accept percentages');
    const emu = parseLength(value);
    if (!Number.isSafeInteger(emu) || emu < 914400 || emu > 51206400)
      throw new Error('pageSize dimensions must be between 1 and 56 inches');
    return emu;
  });
  const widthEmu = requireDefined(lengths[0]),
    heightEmu = requireDefined(lengths[1]);
  let node = first(doc, 'sldSz');
  if (!node) {
    node = doc.createElementNS(
      'http://schemas.openxmlformats.org/presentationml/2006/main',
      'p:sldSz',
    );
    requireDefined(doc.documentElement).insertBefore(node, first(doc, 'notesSz') ?? null);
  }
  node.setAttribute('cx', String(widthEmu));
  node.setAttribute('cy', String(heightEmu));
  node.setAttribute('type', 'custom');
  archive.writeXml('/ppt/presentation.xml', doc);
  return { widthEmu, heightEmu };
}

export function describeSlideSize(archive: OpcArchive) {
  const size = readSlideSize(archive);
  return { ...size, aspectRatio: size.widthEmu / size.heightEmu };
}
