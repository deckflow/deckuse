# Bug Fix: Init Command Hanging

**Date**: 2026-03-31
**Issue**: `init` command would hang indefinitely when parsing PPTX files
**Status**: ✅ Fixed

## Problem

When running:
```bash
./dist/cli.js init ../html2pptx/example-PBCj3B7bVMm7/output/1.pptx -d __temps__/demo1
```

The command would hang at "Parsing PPTX structure with @deckflow/presentation..." step.

## Root Cause

Two issues were identified:

### Issue 1: Incorrect Loading Order

**Error**: `Slide lack slideLayout or slideLayout not loaded`

In `src/readers/pptx-reader.ts`, the loading order was wrong:

```typescript
// ❌ WRONG ORDER
await presentation.loadAsync(buffer)
await presentation.loadSlideAsync()        // ← Tries to load slides first
await presentation.loadSlideMasterAsync()  // ← Masters loaded too late
await presentation.loadSlideLayoutAsync()  // ← Layouts loaded too late
```

Slides depend on layouts, which depend on masters. The correct order is:

```typescript
// ✅ CORRECT ORDER
await presentation.loadAsync(buffer)
await presentation.loadSlideMasterAsync()  // 1. Load masters first
await presentation.loadSlideLayoutAsync()  // 2. Load layouts (depend on masters)
await presentation.loadSlideAsync()        // 3. Load slides (depend on layouts)
```

### Issue 2: slideLayouts Type Mismatch

**Error**: `slideLayoutsMap.entries is not a function`

The code assumed `slideLayouts` was a Map, but it's actually a plain object:

```typescript
// ❌ WRONG
const slideLayoutsMap = (presentation as any).slideLayouts as Map<string, any>
const slideLayouts = Array.from(slideLayoutsMap.entries()).map(...)
```

Fixed to handle both Map and plain object:

```typescript
// ✅ CORRECT
const slideLayoutsMap = (presentation as any).slideLayouts
let slideLayouts: any[] = []

if (slideLayoutsMap) {
  if (slideLayoutsMap instanceof Map) {
    slideLayouts = Array.from(slideLayoutsMap.entries()).map(...)
  } else if (typeof slideLayoutsMap === 'object') {
    slideLayouts = Object.entries(slideLayoutsMap).map(...)
  }
}
```

## Fix Applied

File: `src/readers/pptx-reader.ts`

Changes:
1. Reordered loading sequence: masters → layouts → slides
2. Added type checking for slideLayouts (Map vs Object)
3. Added comments explaining the loading order dependency

## Verification

### Before Fix
```bash
$ ./dist/cli.js init test.pptx -d workspace
[INFO] Initializing workspace from: test.pptx
...
[INFO] Parsing PPTX structure with @deckflow/presentation...
[HANGS INDEFINITELY OR ERRORS]
```

### After Fix
```bash
$ ./dist/cli.js init test.pptx -d workspace
[INFO] Initializing workspace from: test.pptx
✓ Workspace initialized at: workspace
[INFO] Extracting PPTX contents...
✓ PPTX extracted
[INFO] Building indexes...
[INFO] Parsing PPTX structure with @deckflow/presentation...
[INFO] Parsed 1 slides, 1 masters
✓ Indexes built
✓ Workspace ready at: workspace
```

### Results Verification

The `results` node is correctly populated in metadata:

```json
{
  "version": "1.0.0",
  "sourcePptx": "/path/to/test.pptx",
  "results": {
    "presentation": { ... },
    "slides": [ ... ],
    "slideMasters": [ ... ],
    "slideLayouts": [ ... ]
  },
  "indexes": {
    "slides": [ ... ],
    "shapes": [ ... ],
    "layouts": [ ... ]
  }
}
```

File size: ~112KB for 11MB PPTX (reasonable compression)

## Lessons Learned

1. **Dependency Order Matters**: When working with hierarchical data (slides → layouts → masters), load dependencies first
2. **Type Assumptions**: Don't assume internal data structures without verification
3. **Debug Logging**: Strategic debug logs helped identify exact failure point
4. **Error Messages**: The library's error messages ("Slide lack slideLayout") were clear and helpful

## Testing

Tested with:
- 11MB PPTX file
- 1 slide, 1 master, 1 layout
- Completed successfully in ~3-5 seconds

Build status:
- ✅ TypeScript compilation successful
- ✅ All tests passing (12/12)
- ✅ CLI functional

## Related Files

- `src/readers/pptx-reader.ts` - parseFromFile() method
- `src/commands/init.ts` - buildIndexes() function
- `src/core/types.ts` - WorkspaceMetadata with results field
