import type { Diagnostic, ElementRef } from '../core/index.js';

export type ElementKind =
  'paragraph' | 'run' | 'table' | 'tableCell' | 'section' | 'style' | 'bookmark';

export interface IndexedElement {
  ref: ElementRef;
  kind: ElementKind;
  partUri: string;
  name?: string;
  text?: string;
  parentId?: string;
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
  diagnostics?: Diagnostic[];
  changedTargets?: string[];
  changedParts?: string[];
}
