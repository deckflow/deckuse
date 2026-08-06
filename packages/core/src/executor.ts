import {
  AdapterRegistry,
  type AdapterContext,
  type AdapterResolver,
  type FormatAdapter,
} from './adapter.js';
import { commandSchema, err, type Command, type Result } from './schema.js';

export interface ExecutorOptions {
  readonly context?: AdapterContext;
  readonly resolveAdapter?: AdapterResolver;
}
export class Executor {
  readonly #workspaceAdapters = new Map<string, FormatAdapter>();
  constructor(
    readonly registry: AdapterRegistry,
    readonly options: ExecutorOptions = {},
  ) {}
  async execute(input: unknown): Promise<Result<unknown>> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return err(
        'INVALID_COMMAND',
        'Command failed schema validation',
        parsed.error.issues.map((issue) => ({
          severity: 'error',
          code: 'SCHEMA_VALIDATION',
          message: issue.message,
          path: issue.path.map((segment) =>
            typeof segment === 'symbol' ? (segment.description ?? segment.toString()) : segment,
          ),
        })),
      );
    const command = parsed.data;
    if (command.type === 'init') {
      const adapter = this.registry.get(command.format);
      if (!adapter)
        return err('FORMAT_NOT_SUPPORTED', `No adapter registered for format: ${command.format}`);
      const result = await this.#safely(() => adapter.init(command, this.options.context ?? {}));
      if (result.ok) this.#workspaceAdapters.set(command.workspaceId, adapter);
      return result;
    }
    const adapter =
      this.#workspaceAdapters.get(command.workspaceId) ??
      (await this.options.resolveAdapter?.(command.workspaceId, this.options.context ?? {}));
    if (adapter) this.#workspaceAdapters.set(command.workspaceId, adapter);
    if (!adapter)
      return err('WORKSPACE_NOT_FOUND', `Workspace is not initialized: ${command.workspaceId}`);
    return this.#safely(() => adapter.execute(command, this.options.context ?? {}));
  }
  async #safely(operation: () => Promise<Result<unknown>>): Promise<Result<unknown>> {
    try {
      return await operation();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown adapter error';
      return { ok: false, error: { code: 'INTERNAL_ERROR', message, cause }, diagnostics: [] };
    }
  }
}

export const execute = (executor: Executor, command: Command): Promise<Result<unknown>> =>
  executor.execute(command);
export const inspect = (
  executor: Executor,
  workspaceId: string,
  options: Partial<
    Omit<Extract<Command, { type: 'inspect' }>, 'type' | 'version' | 'workspaceId'>
  > = {},
) => executor.execute({ version: '1.0', type: 'inspect', workspaceId, ...options });
export const getText = (
  executor: Executor,
  workspaceId: string,
  ref: Extract<Command, { type: 'getText' }>['ref'],
) => executor.execute({ version: '1.0', type: 'getText', workspaceId, ref });
export const setText = (
  executor: Executor,
  workspaceId: string,
  transactionId: string,
  ref: Extract<Command, { type: 'setText' }>['ref'],
  text: string,
) => executor.execute({ version: '1.0', type: 'setText', workspaceId, transactionId, ref, text });
