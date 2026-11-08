import { appendFileSync } from 'node:fs';
/** Optional benchmark telemetry; never writes to the command output streams. */
function record(phase: string, start: number) {
  const path = process.env['DECKUSE_TIMINGS_FILE'];
  if (!path) return;
  try {
    appendFileSync(
      path,
      `${JSON.stringify({ phase, commandId: process.env['DECKUSE_COMMAND_ID'], pid: process.pid, at: Date.now(), durationMs: performance.now() - start })}\n`,
    );
  } catch {
    /* Telemetry cannot change command success. */
  }
}
export async function timed<T>(phase: string, action: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await action();
  } finally {
    record(phase, start);
  }
}
export function timedSync<T>(phase: string, action: () => T): T {
  const start = performance.now();
  try {
    return action();
  } finally {
    record(phase, start);
  }
}

/** Elapsed runtime startup and module loading before CLI dispatch. */
export function recordCliStartup(): void {
  record('cli-startup', 0);
}
