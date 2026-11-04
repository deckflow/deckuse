#!/usr/bin/env node
/** Probe only the synthetic fixture. Close only that presentation, never other windows. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const file = resolve(process.argv[2] ?? '__temps__/native-capabilities.pptx');
if (process.platform !== 'darwin')
  throw Error(
    'This probe requires macOS PowerPoint; use docs/native-capabilities.md for manual checks',
  );
const script = `with timeout of 25 seconds
 tell application "Microsoft PowerPoint"
  open POSIX file ${JSON.stringify(file)}
  set checkedDeck to active presentation
  try
   set checkedSlide to slide 2 of checkedDeck
   set nativeGroup to shape "Movable group" of checkedSlide
   set boundLine to connector "Attached line" of checkedSlide
   if begin connected of connector format of boundLine is not true then error "Start is not attached"
   if end connected of connector format of boundLine is not true then error "End is not attached"
   set left position of nativeGroup to (left position of nativeGroup) + 18
   if begin connected of connector format of boundLine is not true then error "Group move detached start"
   if end connected of connector format of boundLine is not true then error "Group move detached end"
   if shape type of shape "Bezier wave" of checkedSlide is not shape type free form then error "Path is not a freeform"
   if fill format type of fill format of shape "Bezier wave" of checkedSlide is not fill gradient then error "Gradient was lost"
   if connection site count of shape "Bezier wave" of checkedSlide is not 1 then error "Custom connection site missing"
   if begin connected of connector format of connector "Wave connection" of checkedSlide is not true then error "Custom path endpoint detached"
   set matrix to table object of shape table "Merged matrix" of checkedSlide
   set h1 to height of row 1 of matrix
   set h2 to height of row 2 of matrix
   set h3 to height of row 3 of matrix
   if h1 > 25.3 or h1 < 25.1 or h2 > 32.5 or h2 < 32.3 or h3 > 57.7 or h3 < 57.5 then error "Physical row heights changed"
   set mergedWidth to width of shape of cell 1 of row 1 of matrix
   set ordinaryWidth to width of shape of cell 1 of row 2 of matrix
   if mergedWidth < ordinaryWidth * 1.9 then error "Table header is not merged"
   if shape type of shape "Editable data" of checkedSlide is not shape type chart then error "Chart is not native"
   close checkedDeck saving no
   return "PASS: native group move, both bindings, custom geometry/site, gradient, row heights, table merge, chart"
  on error errText number errNumber
   close checkedDeck saving no
   error errText number errNumber
  end try
 end tell
end timeout`;
const { stdout } = await promisify(execFile)('osascript', ['-e', script], { timeout: 35000 });
console.log(stdout.trim());
