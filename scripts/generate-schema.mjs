import { mkdir, writeFile } from 'node:fs/promises';
import { commandJsonSchema } from '../packages/core/dist/index.js';
const directory = new URL('../packages/core/schema/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL('command.schema.json', directory),
  `${JSON.stringify(commandJsonSchema, null, 2)}\n`,
);
