export { pptxAdapter, pptxCapabilities } from './adapter.js';
export { buildIndex } from './indexer.js';
export {
  EDITION,
  EDITION_VARIANT,
  DISTRIBUTION_CHANNEL,
  editionCapabilities,
  editionMetadata,
  editionGatedWriteKind,
  writeDenialReason,
  assertWritable,
  clearPptxEditionExtension,
  getPptxEditionExtension,
  registerPptxEditionExtension,
} from './edition.js';
export type {
  EditionGatedWriteKind,
  GatedMutationContext,
  PptxEditionExtension,
} from './edition.js';
export { classifyChartDocument, classifyChartPart } from './chart-classify.js';
export type { ChartVariant } from './chart-classify.js';
export { applyChartProperties } from './chart.js';
export { updateChart } from './elements.js';
export { nodeFor, focusMutationNode } from './node-for.js';
export { applyShapeProperties, assertChartProperties } from './properties.js';
export { mapDottedProperties } from './resolve-properties.js';
export { slidesForItem } from './indexer.js';
export { NS, children, first, descendants, setNodeText, setNodeTextBlocks } from './xml.js';
export type { IndexedElement, IndexFile, ElementKind, MutationOutcome } from './types.js';
export type { ParsedTarget } from './addressing.js';
