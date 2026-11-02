#!/usr/bin/env node
// Opt-in native check, only closes the specimen it opens. Never closes other Office windows.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
const input = resolve(process.argv[2]),
  pdf = resolve(process.argv[3]);
const word = extname(input).toLowerCase() === '.docx';
const app = word ? 'Microsoft Word' : 'Microsoft PowerPoint';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const before = hash(await readFile(input));
await mkdir(dirname(pdf), { recursive: true });
const script = `on run argv
set sourcePath to item 1 of argv
set pdfPath to item 2 of argv
tell application "${app}"
with timeout of 30 seconds
${
  word
    ? `set specimen to open (POSIX file sourcePath) file name sourcePath read only true add to recent files false
repeat 20 times
try
set specimen to document ${JSON.stringify(basename(input))}
exit repeat
on error
delay 0.1
end try
end repeat`
    : 'open (POSIX file sourcePath)\nset specimen to active presentation'
}
try
${word ? 'save as specimen file name pdfPath file format format PDF' : 'save specimen in (POSIX file pdfPath) as save as PDF'}
${!word && process.argv.includes('--roundtrip') ? 'save specimen in (POSIX file (item 3 of argv)) as save as Open XML presentation' : ''}
close specimen saving no
on error msg number num
try
close specimen saving no
end try
error msg number num
end try
return version
end timeout
end tell
end run`;
const path = pdf + '.applescript';
await writeFile(path, script);
const record = {
  input,
  inputSha256: before,
  nativeOpen: 'unverified',
  nativeRender: 'unverified',
  nativeVisual: 'unverified',
  platform: process.platform,
  backend: app,
};
try {
  const result = await promisify(execFile)(
    'osascript',
    [path, input, pdf, pdf + '.roundtrip.pptx'],
    { timeout: 45000, maxBuffer: 1024 * 1024 },
  );
  const bytes = await readFile(pdf);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('No PDF produced');
  if (hash(await readFile(input)) !== before)
    throw new Error('Source specimen was changed by native software');
  Object.assign(record, {
    nativeOpen: 'passed',
    nativeRender: 'passed',
    version: result.stdout.trim(),
    pdfSha256: hash(bytes),
    sourceUnchanged: true,
  });
} catch (cause) {
  record.reason = cause.message;
  process.exitCode = 1;
}
await writeFile(pdf + '.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
