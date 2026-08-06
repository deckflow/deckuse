import type { Command, Result, WorkspaceManifest } from './schema.js';

export interface AdapterContext {
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}

export type AdapterResolver = (
  workspaceId: string,
  context: AdapterContext,
) => Promise<FormatAdapter | undefined> | FormatAdapter | undefined;

export interface FormatAdapter {
  readonly format: string;
  readonly version: string;
  init(
    command: Extract<Command, { type: 'init' }>,
    context: AdapterContext,
  ): Promise<Result<WorkspaceManifest>>;
  execute(
    command: Exclude<Command, { type: 'init' }>,
    context: AdapterContext,
  ): Promise<Result<unknown>>;
}

export class AdapterRegistry {
  readonly #adapters = new Map<string, FormatAdapter>();
  register(adapter: FormatAdapter): this {
    const key = adapter.format.toLowerCase();
    if (this.#adapters.has(key)) throw new Error(`Adapter already registered: ${key}`);
    this.#adapters.set(key, adapter);
    return this;
  }
  get(format: string): FormatAdapter | undefined {
    return this.#adapters.get(format.toLowerCase());
  }
  has(format: string): boolean {
    return this.#adapters.has(format.toLowerCase());
  }
  formats(): readonly string[] {
    return [...this.#adapters.keys()].sort();
  }
}
