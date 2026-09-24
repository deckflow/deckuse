import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Unescape common CLI escape sequences in `--text` / `--value`.
 * Shells often pass a literal backslash-n; agents expect real newlines.
 * `\\n` stays as the two-character sequence `\n` after one unescape pass.
 */
export function unescapeCliText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch !== '\\' || i + 1 >= value.length) {
      out += ch;
      continue;
    }
    const next = value[i + 1]!;
    switch (next) {
      case 'n':
        out += '\n';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case '\\':
        out += '\\';
        i++;
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

export async function resolveCliText(options: {
  readonly value?: string;
  readonly textFile?: string;
  readonly raw?: boolean;
}): Promise<string | undefined> {
  if (options.textFile !== undefined) {
    return readFile(resolve(options.textFile), 'utf8');
  }
  if (options.value === undefined) return undefined;
  return options.raw ? options.value : unescapeCliText(options.value);
}
