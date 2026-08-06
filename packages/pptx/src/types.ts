import type { ElementRef } from '@deckuse/core';
export type ElementKind =
  | 'slide'
  | 'shape'
  | 'textbox'
  | 'picture'
  | 'connector'
  | 'group'
  | 'table'
  | 'tableCell'
  | 'chart'
  | 'notes'
  | 'master'
  | 'layout'
  | 'theme';
export interface IndexedElement {
  ref: ElementRef;
  kind: ElementKind;
  partUri: string;
  slideId?: string;
  name?: string;
  text?: string;
  parentId?: string;
  transform?: Record<string, number | boolean>;
  location?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}
export interface IndexFile {
  revision: string;
  elements: IndexedElement[];
}
export interface MutationOutcome {
  changed: boolean;
  matched?: number;
  refs?: ElementRef[];
  partUri?: string;
  diagnostics?: import('@deckuse/core').Diagnostic[];
}
