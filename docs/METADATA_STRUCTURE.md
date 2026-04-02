# DeckUse Metadata Structure

## Overview

The workspace metadata (`.deckuse/metadata.json`) stores the **single source of truth** for all PPTX structure data from `@deckflow/presentation`.

## Metadata Schema

```typescript
interface WorkspaceMetadata {
  version: string              // DeckUse version
  sourcePptx?: string          // Path to original PPTX file
  initialized: Date            // When workspace was created
  lastModified: Date           // Last modification time

  // Complete parsing results from @deckflow/presentation
  results?: {
    presentation?: any         // Full presentation structure
    slides?: any[]             // All slide data
    slideMasters?: any[]       // All slide master data
    slideLayouts?: any[]       // All slide layout data
  }
}
```

## Design Philosophy

### Single Source of Truth

All data comes from `results` - there are no separate indexes or caches. This provides:

1. **Simplicity**: One data structure to maintain
2. **Consistency**: No risk of indexes getting out of sync
3. **Completeness**: Full PPTX structure preserved
4. **Flexibility**: Commands query results directly

### Why No Indexes?

The `results` structure from `@deckflow/presentation` already contains all necessary information:
- Slides with complete structure
- Shape trees with all properties
- Layout and master relationships
- Text content and styling

Creating separate indexes would be:
- Redundant (duplicating data)
- Error-prone (sync issues)
- Less flexible (limited query capabilities)

## Data Flow

### During Init

```
PPTX File
  ↓
@deckflow/presentation.loadAsync()
  ↓
Parse: masters → layouts → slides
  ↓
Convert to JSON
  ↓
Save to results
(single source of truth)
```

### During Commands

```
Command Execution
  ↓
Load metadata.json
  ↓
Query results directly
  ↓
workspace.getSlides()
workspace.getSlide(index)
workspace.getSlideMasters()
workspace.getSlideLayouts()
```

## Example Metadata

```json
{
  "version": "1.0.0",
  "sourcePptx": "/path/to/presentation.pptx",
  "initialized": "2026-03-31T02:51:27.599Z",
  "lastModified": "2026-03-31T02:51:27.769Z",

  "results": {
    "presentation": {
      "slideSize": { "cx": 9144000, "cy": 6858000 },
      "notesSize": { "cx": 6858000, "cy": 9144000 },
      "defaultTextStyle": {...}
    },
    "slides": [
      {
        "_layoutRef": "ppt/slideLayouts/slideLayout1.xml",
        "_masterRef": "ppt/slideMasters/slideMaster1.xml",
        "clrMapOvr": {...},
        "spTree": [
          { "id": {...} },
          { "cxnSp": {...} },
          { "sp": { "txBody": {...} } }
        ]
      }
    ],
    "slideMasters": [
      {
        "clrMap": {...},
        "sldLayoutIdLst": [...],
        "txStyles": {...}
      }
    ],
    "slideLayouts": [
      {
        "path": "ppt/slideLayouts/slideLayout1.xml",
        "data": {
          "cSld": {...},
          "type": "title"
        }
      }
    ]
  }
}
```

## Usage in Commands

### Get All Slides

```typescript
const workspace = await Workspace.load(workspaceDir)
const slides = workspace.getSlides()  // Returns results.slides

slides.forEach((slide, idx) => {
  console.log(`Slide ${idx + 1}:`, slide._layoutRef)
})
```

### Get Specific Slide

```typescript
const slide = workspace.getSlide(1)  // 1-based index
if (slide) {
  console.log('Shapes:', slide.spTree.length)
  console.log('Layout:', slide._layoutRef)
}
```

### Query Shape Tree

```typescript
const slide = workspace.getSlide(1)
const shapes = slide?.spTree ?? []

shapes.forEach(shape => {
  const shapeType = Object.keys(shape)[0]
  const shapeData = shape[shapeType]

  if (shapeData?.txBody) {
    console.log('Found text shape')
  }
})
```

### Selector System

The selector system queries `results` directly:

```typescript
// src/core/selector.ts
private static async resolveSlide(selector, metadata) {
  const slides = metadata.results?.slides ?? []

  if (selector.index !== undefined) {
    return slides[selector.index - 1]
  }

  // Filter slides
  return slides.filter(slide => matchesFilter(slide, selector.filters))
}
```

## File Size

For an 11MB PPTX file:
- Metadata: ~112KB
- Compression ratio: ~1%
- Load time: Instant (JSON parse)

## Benefits

✅ **Single Source**: One data structure, no sync issues
✅ **Complete**: Full PPTX structure preserved
✅ **Fast**: JSON parse is very fast
✅ **Simple**: No complex index management
✅ **Flexible**: Can query any aspect of structure

## Future Enhancements

1. **Lazy Loading**: Load results only when needed
2. **Compression**: Gzip metadata for very large presentations
3. **Incremental Updates**: Track changes for partial updates
4. **Caching**: In-memory cache for frequently accessed data
