/** Product edition for a DeckUse build. */
export type Edition = 'community' | 'commercial';

/** Community defaults. Commercial overlay replaces this package with matching exports. */
export const EDITION: Edition = 'community';
export const EDITION_VARIANT = 'community';
export const DISTRIBUTION_CHANNEL = 'oss';

/**
 * Status / documentation capability claims for this edition.
 * Master / layout / theme / advanced-chart *writes* are hard-denied in shared
 * `@deckflow/deckuse-pptx` unless a proprietary `PptxEditionExtension` is
 * registered — flipping these flags alone never opens those write paths.
 */
export const editionCapabilities = {
  mastersEdit: false,
  layoutsEdit: false,
  themeEdit: false,
  chartBasicOnly: true,
} as const;

export type EditionCapabilities = typeof editionCapabilities;

export const editionMetadata = {
  edition: EDITION,
  variant: EDITION_VARIANT,
  'distribution-channel': DISTRIBUTION_CHANNEL,
} as const;
