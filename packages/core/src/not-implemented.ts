import type { FormatAdapter } from './adapter.js';
import { err } from './schema.js';
export const createNotImplementedAdapter = (format: string, version = '0.0.0'): FormatAdapter => ({
  format,
  version,
  async init() {
    return Promise.resolve(
      err('FORMAT_NOT_IMPLEMENTED', `The ${format} adapter is reserved but not implemented`),
    );
  },
  async execute() {
    return Promise.resolve(
      err('FORMAT_NOT_IMPLEMENTED', `The ${format} adapter is reserved but not implemented`),
    );
  },
});
