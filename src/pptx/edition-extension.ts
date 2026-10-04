import type { AtomicCommand, Diagnostic, Result } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import type { ParsedTarget } from './addressing.js';
import type { IndexedElement, IndexFile, MutationOutcome } from './types.js';

/**
 * Optional edition extension registered by proprietary overlays.
 * Community builds leave this unset; gated writes (master/layout/theme/advanced chart)
 * never run the shared mutation pipeline — `assertWritable` alone cannot unlock them.
 *
 * Overlay authors implement `applyGatedMutation` / `writeGatedText` in the private tree.
 * This surface is for edition hooks — not a stable CLI contract.
 */
export interface GatedMutationContext {
  command: AtomicCommand;
  archive: OpcArchive;
  index: IndexFile;
  item: IndexedElement;
  target?: string;
  parsed?: ParsedTarget;
}

export interface PptxEditionExtension {
  /**
   * Optional policy hint. Community does **not** apply shared mutators when this
   * returns `ok`; writes require `applyGatedMutation` / `writeGatedText`.
   * - `err` — deny with the given error
   * - `undefined` / `ok` — fall through to apply-hook-or-hard-deny
   */
  assertWritable?(item: IndexedElement, archive: OpcArchive): Result<void> | undefined;
  /**
   * Apply a single gated write. Community never executes this path itself.
   */
  applyGatedMutation?(ctx: GatedMutationContext): Result<MutationOutcome>;
  /**
   * Apply text onto a gated element (used by `replaceText`). Community never
   * calls `setNodeText` on gated parts.
   */
  writeGatedText?(
    archive: OpcArchive,
    item: IndexedElement,
    text: string,
    diagnostics: Diagnostic[],
  ): Result<void>;
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
