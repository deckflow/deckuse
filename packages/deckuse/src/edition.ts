/** Product edition metadata for the DeckUse CLI package. */
export type Edition = 'community' | 'commercial';

export const EDITION: Edition = 'community';
export const EDITION_VARIANT = 'community';
export const DISTRIBUTION_CHANNEL = 'oss';

export const editionMetadata = {
  edition: EDITION,
  variant: EDITION_VARIANT,
  'distribution-channel': DISTRIBUTION_CHANNEL,
} as const;
