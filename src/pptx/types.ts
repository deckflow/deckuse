import type { ElementRef } from '../core/index.js';
export type ElementKind =
  | 'slide'
  | 'shape'
  | 'textbox'
  | 'picture'
  | 'video'
  | 'audio'
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
  slides?: number[];
  diagnostics?: import('../core/index.js').Diagnostic[];
}
