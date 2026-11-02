import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
/** Bounded process group: timeout/output overflow also kills renderer descendants. */
export function runOfficeProcess(
  file: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(file, args, { detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '',
      failure: Error | undefined;
    const stop = (message: string) => {
      failure = new Error(message);
      try {
        if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      stop(`${file} timed out after ${String(timeoutMs)} ms`);
    }, timeoutMs);
    const append = (chunk: Buffer, error: boolean) => {
      if (error) stderr += chunk.toString();
      else stdout += chunk.toString();
      if (stdout.length + stderr.length > 1024 * 1024) stop(`${file} exceeded its output limit`);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      append(chunk, false);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      append(chunk, true);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(`${file} failed (${String(code)}): ${stderr.trim() || stdout.trim()}`));
      else resolve({ stdout, stderr });
    });
  });
}
export async function convertOfficeToPdf(
  input: string,
  outputDirectory: string,
  profileDirectory: string,
) {
  const executable = process.env['DECKUSE_SOFFICE_PATH'] ?? 'soffice';
  const version = (await runOfficeProcess(executable, ['--version'])).stdout.trim();
  await runOfficeProcess(executable, [
    `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDirectory,
    input,
  ]);
  return { engine: 'libreoffice', version };
}
