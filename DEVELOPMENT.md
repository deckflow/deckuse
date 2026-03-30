# DeckUse Development Guide

## Project Structure

```
src/
  cli.ts                 # CLI entry point
  index.ts               # Library API exports
  commands/              # Command implementations
    init.ts              # Initialize workspace from PPTX
    status.ts            # Show workspace status
    commit.ts            # Build PPTX from workspace
    list-slides.ts       # List slides
    show-slide.ts        # Show slide details
    get-text.ts          # Get text content
    set-text.ts          # Set text content
    replace-text.ts      # Find and replace text
    set-font-size.ts     # Set font size
  core/
    workspace.ts         # Workspace management
    selector.ts          # Selector parsing and resolution
    types.ts             # TypeScript type definitions
  readers/
    pptx-reader.ts       # PPTX reading wrapper
  writers/
    pptx-writer.ts       # PPTX writing wrapper
  validators/
  utils/
    logger.ts            # Logging utility
    errors.ts            # Custom error classes
tests/
  unit/                  # Unit tests
  integration/           # Integration tests
```

## Getting Started

### Prerequisites

This project uses **pnpm** as the package manager. Install it if you haven't:

```bash
npm install -g pnpm
```

### Install Dependencies

```bash
pnpm install
```

> **Note:** Always use `pnpm` instead of `npm` for this project.

### Build the Project

```bash
pnpm build
```

This will:
- Compile TypeScript to JavaScript
- Generate type declarations
- Output to `dist/` directory

### Development Mode

```bash
pnpm dev
```

This runs the build in watch mode, automatically rebuilding on file changes.

### Run Tests

```bash
pnpm test
```

For test UI:

```bash
pnpm test:ui
```

### Type Checking

```bash
pnpm typecheck
```

## Implementation Status

### ✅ Completed

- [x] Project structure and configuration
- [x] Core type definitions
- [x] Workspace management
- [x] Selector system (parsing and resolution)
- [x] Basic commands:
  - [x] init
  - [x] status
  - [x] commit
  - [x] list slides
  - [x] show slide
  - [x] get text
  - [x] set text
  - [x] replace text
  - [x] set font-size
- [x] CLI framework with commander
- [x] Unit tests for core modules
- [x] Error handling system
- [x] Logger utility

### 🚧 TODO

The following components have placeholder implementations and need actual integration with the PPTX libraries:

#### PPTX Reader (`src/readers/pptx-reader.ts`)

Currently returns empty/placeholder data. Needs integration with `@deckflow/presentation` to:
- Read presentation structure
- Extract slide information
- Read shape data
- Extract text content
- Get metadata

#### PPTX Writer (`src/writers/pptx-writer.ts`)

Currently has no-op methods. Needs integration with `@deckflow/pptx-modifier` to:
- Modify text content
- Update font properties
- Modify shape geometry
- Save changes back to XML files

#### Additional Commands

Many commands from the README are not yet implemented:
- validate
- doctor
- inspect
- tree
- find
- query
- stats
- More S0 commands (font-family, font-color, bold, italic, paragraph-align, etc.)
- S1 commands (fill, line, z-order, crop, etc.)
- S2 commands (with confirmation)

### Next Steps

1. **Integrate @deckflow/presentation**
   - Study the API documentation
   - Implement PptxReader methods
   - Update index building in init command

2. **Integrate @deckflow/pptx-modifier**
   - Study the API documentation
   - Implement PptxWriter methods
   - Test write operations

3. **Add More Commands**
   - Implement remaining S0 commands (safe text/formatting operations)
   - Add S1 commands (fill, line, z-order, etc.)
   - Implement diagnostic commands (validate, doctor, inspect)

4. **Testing**
   - Create test PPTX files
   - Write integration tests
   - Test full workflows

5. **Documentation**
   - API documentation
   - Usage examples
   - Contributing guide

## Architecture Notes

### Workspace Design

The workspace is a directory containing:
- Extracted PPTX contents (XML files, media, etc.)
- `.deckuse/` directory with:
  - `metadata.json` - workspace metadata and indexes

### Selector System

Selectors allow targeting specific parts of a presentation:
- `slide:3` - slide by index
- `slide:3/title` - named element in slide
- `shape[type=textbox]` - shapes by filter
- `text[contains('keyword')]` - text search

The selector is parsed into a `Selector` object, then resolved to concrete targets using the workspace indexes.

### Command Pattern

Each command is implemented as a separate module that:
1. Loads the workspace
2. Performs its operation
3. Updates metadata if needed
4. Provides user feedback

### Error Handling

Custom error classes provide clear error messages:
- `WorkspaceNotInitializedError`
- `InvalidSelectorError`
- `CommandError`
- `ValidationError`
etc.

## Contributing

When adding new features:

1. Add types to `src/core/types.ts`
2. Implement the feature
3. Add command if needed
4. Register command in CLI
5. Export from `src/index.ts` if it's part of the public API
6. Add tests
7. Update documentation
