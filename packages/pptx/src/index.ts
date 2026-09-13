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
export type { EditionGatedWriteKind, PptxEditionExtension } from './edition.js';
export { classifyChartDocument, classifyChartPart } from './chart-classify.js';
export type { ChartVariant } from './chart-classify.js';
export { applyChartProperties } from './chart.js';
export { setNodeText, setNodeTextBlocks } from './xml.js';
export type { IndexedElement, IndexFile, ElementKind } from './types.js';
