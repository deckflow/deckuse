import { err, ok, type Result } from '../core/index.js';
import {
  EDITION,
  EDITION_VARIANT,
  DISTRIBUTION_CHANNEL,
  editionCapabilities,
  editionMetadata,
} from '../edition-config/index.js';
import type { OpcArchive } from '../opc/index.js';
import { classifyChartPart, type ChartVariant } from './chart-classify.js';
import { getPptxEditionExtension } from './edition-extension.js';
import type { IndexedElement } from './types.js';

export type { Edition } from '../edition-config/index.js';
export { EDITION, EDITION_VARIANT, DISTRIBUTION_CHANNEL, editionCapabilities, editionMetadata };
export {
  clearPptxEditionExtension,
  getPptxEditionExtension,
  registerPptxEditionExtension,
  type PptxEditionExtension,
} from './edition-extension.js';

const isThemePart = (item: IndexedElement): boolean =>
  item.kind === 'theme' || item.partUri.startsWith('/ppt/theme/');

const isMasterPart = (item: IndexedElement): boolean =>
  item.kind === 'master' || item.partUri.startsWith('/ppt/slideMasters/');

const isLayoutPart = (item: IndexedElement): boolean =>
  item.kind === 'layout' || item.partUri.startsWith('/ppt/slideLayouts/');

const chartVariantOf = (item: IndexedElement, archive: OpcArchive): ChartVariant | undefined => {
  if (item.kind !== 'chart') return undefined;
  const chartPart =
    typeof item.payload?.['chartPart'] === 'string' ? item.payload['chartPart'] : undefined;
  if (!chartPart || !archive.getPart(chartPart)) return 'advanced';
  return classifyChartPart(archive, chartPart);
};

/** Targets whose writes are never opened by `editionCapabilities` alone. */
export type EditionGatedWriteKind = 'theme' | 'master' | 'layout' | 'advanced-chart';

export const editionGatedWriteKind = (
  item: IndexedElement,
  archive: OpcArchive,
): EditionGatedWriteKind | undefined => {
  if (isThemePart(item)) return 'theme';
  if (isMasterPart(item)) return 'master';
  if (isLayoutPart(item)) return 'layout';
  if (chartVariantOf(item, archive) === 'advanced') return 'advanced-chart';
  return undefined;
};

const hardDenyMessage = (kind: EditionGatedWriteKind): string => {
  switch (kind) {
    case 'theme':
      return `Theme editing is not available (edition=${EDITION}); theme parts are preserve-only`;
    case 'master':
      return `Master slide editing requires the commercial edition (edition=${EDITION})`;
    case 'layout':
      return `Layout slide editing requires the commercial edition (edition=${EDITION})`;
    case 'advanced-chart':
      return `Advanced chart editing requires the commercial edition (edition=${EDITION})`;
  }
};

/**
 * Returns a denial message when writing `item` is forbidden.
 *
 * Master / layout / theme / advanced-chart writes are hard-denied in shared code.
 * Only a registered `PptxEditionExtension.assertWritable` can allow them —
 * flipping `editionCapabilities` alone never opens these paths.
 */
export const writeDenialReason = (
  item: IndexedElement,
  archive: OpcArchive,
): string | undefined => {
  const kind = editionGatedWriteKind(item, archive);
  if (!kind) return undefined;

  const ext = getPptxEditionExtension();
  if (ext?.assertWritable) {
    const verdict = ext.assertWritable(item, archive);
    if (verdict !== undefined) {
      if (verdict.ok) return undefined;
      return verdict.error.message;
    }
  }

  return hardDenyMessage(kind);
};

export const assertWritable = (item: IndexedElement, archive: OpcArchive): Result<void> => {
  const reason = writeDenialReason(item, archive);
  if (reason) return err('UNSUPPORTED_CAPABILITY', reason);
  return ok(undefined);
};
