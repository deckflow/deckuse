import type { Result } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import type { IndexedElement } from './types.js';

/**
 * Optional edition extension registered by proprietary overlays.
 * Community builds leave this unset; gated writes (master/layout/theme/advanced chart)
 * are hard-denied regardless of `editionCapabilities`.
 *
 * Extension authors may call exported pptx primitives (`setNodeText`, `applyChartProperties`,
 * `classifyChartPart`, …). This surface is for edition hooks — not a stable CLI contract.
 */
export interface PptxEditionExtension {
  /**
   * Decide writability for edition-gated targets only.
   * - `ok` — allow the shared mutation pipeline to proceed
   * - `err` — deny with the given error
   * - `undefined` — fall through to the community hard-deny message
   */
  assertWritable?(item: IndexedElement, archive: OpcArchive): Result<void> | undefined;
}

let registered: PptxEditionExtension | undefined;

export const registerPptxEditionExtension = (extension: PptxEditionExtension): void => {
  registered = extension;
};

export const getPptxEditionExtension = (): PptxEditionExtension | undefined => registered;

/** Test / teardown helper — clears any registered extension. */
export const clearPptxEditionExtension = (): void => {
  registered = undefined;
};
