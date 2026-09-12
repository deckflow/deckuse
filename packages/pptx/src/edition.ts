import { err, ok, type Result } from '@deckflow/deckuse-core';
import {
  EDITION,
  EDITION_VARIANT,
  DISTRIBUTION_CHANNEL,
  editionCapabilities,
  editionMetadata,
} from '@deckflow/deckuse-edition-config';
import type { OpcArchive } from '@deckflow/deckuse-opc';
import { classifyChartPart, type ChartVariant } from './chart-classify.js';
import type { IndexedElement } from './types.js';

export type { Edition } from '@deckflow/deckuse-edition-config';
export { EDITION, EDITION_VARIANT, DISTRIBUTION_CHANNEL, editionCapabilities, editionMetadata };

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

/**
 * Returns a denial message when this edition forbids writing `item`.
 * Theme writes are forbidden in every edition when themeEdit is false.
 */
export const writeDenialReason = (
  item: IndexedElement,
  archive: OpcArchive,
): string | undefined => {
  if (!editionCapabilities.themeEdit && isThemePart(item))
    return `Theme editing is not available (edition=${EDITION}); theme parts are preserve-only`;

  if (!editionCapabilities.mastersEdit && isMasterPart(item))
    return `Master slide editing requires the commercial edition (edition=${EDITION})`;

  if (!editionCapabilities.layoutsEdit && isLayoutPart(item))
    return `Layout slide editing requires the commercial edition (edition=${EDITION})`;

  if (editionCapabilities.chartBasicOnly) {
    const variant = chartVariantOf(item, archive);
    if (variant === 'advanced')
      return `Advanced chart editing requires the commercial edition (edition=${EDITION})`;
  }

  return undefined;
};

export const assertWritable = (item: IndexedElement, archive: OpcArchive): Result<void> => {
  const reason = writeDenialReason(item, archive);
  if (reason) return err('UNSUPPORTED_CAPABILITY', reason);
  return ok(undefined);
};
