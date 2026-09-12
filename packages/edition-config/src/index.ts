/** Product edition for a DeckUse build. */
export type Edition = 'community' | 'commercial';

/** Community defaults. Commercial overlay replaces this package with matching exports. */
export const EDITION: Edition = 'community';
export const EDITION_VARIANT = 'community';
export const DISTRIBUTION_CHANNEL = 'oss';

/**
 * Capability flags for this edition.
 * Type A (already in shared code): gated here.
 * Type B (proprietary): must live only in private commercial packages via hooks — never here as implementations.
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
