# Refactoring: Removed Indexes from Metadata

**Date**: 2026-03-31
**Change**: Simplified metadata structure by removing separate indexes
**Status**: ✅ Complete

## Motivation

The original design had both `indexes` and `results` in metadata:

```json
{
  "indexes": {
    "slides": [...],   // Lightweight references
    "shapes": [...],
    "layouts": [...]
  },
  "results": {
    "presentation": {...},
    "slides": [...],       // Complete data
    "slideMasters": [...],
    "slideLayouts": [...]
  }
}
```

**Problems**:
1. **Data Duplication**: Same information in two places
2. **Sync Risk**: Indexes could get out of sync with results
3. **Complexity**: Need to maintain both structures
4. **Limited Value**: `results` already contains all needed information

## Solution

**Single Source of Truth**: Keep only `results`

```json
{
  "version": "1.0.0",
  "sourcePptx": "/path/to/file.pptx",
  "initialized": "2026-03-31T...",
  "lastModified": "2026-03-31T...",
  "results": {
    "presentation": {...},
    "slides": [...],
    "slideMasters": [...],
    "slideLayouts": [...]
  }
}
```

## Changes Made

### 1. Updated Types (`src/core/types.ts`)

**Removed**:
- `SlideIndex`, `ShapeIndex`, `LayoutIndex` interfaces
- `indexes` field from `WorkspaceMetadata`

**Result**: Simpler type definitions

### 2. Updated Workspace (`src/core/workspace.ts`)

**Removed methods**:
- `updateSlideIndex()`
- `updateShapeIndex()`
- `updateLayoutIndex()`

**Added helper methods**:
```typescript
getSlideCount(): number
getSlides(): any[]
getSlide(index: number): any | null
getSlideMasters(): any[]
getSlideLayouts(): any[]
```

### 3. Updated Init Command (`src/commands/init.ts`)

**Before**:
```typescript
const results = await reader.parseFromFile(pptxPath)

// Save results
await workspace.updateResults(results)

// Build indexes from results
const slideIndex = results.slides.map(...)
await workspace.updateSlideIndex(slideIndex)

const shapeIndex = buildShapes(results)
await workspace.updateShapeIndex(shapeIndex)

const layoutIndex = buildLayouts(results)
await workspace.updateLayoutIndex(layoutIndex)
```

**After**:
```typescript
const results = await reader.parseFromFile(pptxPath)

// Save results (single source of truth)
await workspace.updateResults(results)
```

**Result**: 50 lines of code removed ✂️

### 4. Updated Selector (`src/core/selector.ts`)

**Before**:
```typescript
const { indexes } = metadata
const slide = indexes.slides.find(s => s.index === selector.index)
```

**After**:
```typescript
const slides = metadata.results?.slides ?? []
const slide = slides[selector.index - 1]
```

**Result**: Direct access to source data, no index layer

### 5. Updated Commands

All commands updated to use `workspace.getSlides()` etc:

- `src/commands/status.ts`
- `src/commands/list-slides.ts`
- `src/commands/show-slide.ts`

## Benefits

### ✅ Simplicity
- Single data structure to maintain
- No need to keep indexes in sync with results
- Less code, fewer bugs

### ✅ Performance
- No overhead of building indexes
- Faster init (removed index building step)
- JSON parse is very fast (~112KB in milliseconds)

### ✅ Flexibility
- Can query any aspect of results structure
- Not limited to pre-defined indexes
- Easy to add new query patterns

### ✅ Maintainability
- Less code to maintain
- Clearer data flow
- Single source of truth

## Verification

### Build Status
```bash
✅ TypeScript compilation successful
✅ All tests passing (12/12)
✅ CLI functional
```

### Test Results
```bash
$ ./dist/cli.js init test.pptx -d workspace
✓ Workspace initialized
✓ PPTX extracted
✓ Parsed 1 slides, 1 masters, 1 layouts
✓ Workspace ready

$ ./dist/cli.js status workspace
=== Content ===
Slides:       1
Masters:      1
Layouts:      1

$ ./dist/cli.js list slides workspace
Index | Layout Ref        | Shapes | Content
------|-------------------|--------|------------------
    1 | ppt/slideLayouts/ |     21 | Yes
```

### Metadata Verification
```json
{
  "initialized": "2026-03-31T02:51:27.599Z",
  "lastModified": "2026-03-31T02:51:27.769Z",
  "results": {
    "presentation": true,
    "slidesCount": 1,
    "mastersCount": 1,
    "layoutsCount": 1
  },
  "sourcePptx": "/path/to/test.pptx",
  "version": "1.0.0"
}
```

✅ No `indexes` field
✅ All data in `results`
✅ File size: 112KB (same as before)

## Migration

**Existing workspaces**: No migration needed
- Old workspaces with `indexes` will still load (ignored)
- New workspaces will only have `results`
- All commands work with both formats

## Code Impact

**Lines of code**:
- Removed: ~150 lines (index building, maintenance)
- Added: ~30 lines (helper methods)
- **Net reduction: ~120 lines** 🎉

**Files changed**:
- `src/core/types.ts`
- `src/core/workspace.ts`
- `src/core/selector.ts`
- `src/commands/init.ts`
- `src/commands/status.ts`
- `src/commands/list-slides.ts`
- `src/commands/show-slide.ts`
- `docs/METADATA_STRUCTURE.md`

## Conclusion

This refactoring significantly simplifies the codebase while maintaining all functionality. The single source of truth pattern makes the code more maintainable and less error-prone.

**Recommendation**: ✅ Keep this design going forward
