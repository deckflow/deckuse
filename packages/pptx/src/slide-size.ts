import {
  DEFAULT_SLIDE_HEIGHT_EMU,
  DEFAULT_SLIDE_WIDTH_EMU,
  type LengthContext,
} from '@deckflow/deckuse-core';
import type { OpcArchive } from '@deckflow/deckuse-opc';
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
