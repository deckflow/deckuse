# DeckUse Project Rules

## Package Manager

**Use pnpm instead of npm**

```bash
# ✅ Correct
pnpm install
pnpm add <package>
pnpm remove <package>
pnpm build
pnpm test

# ❌ Wrong
npm install
npm install <package>
```

**Why:** This project uses pnpm for better dependency management and disk space efficiency.

## TypeScript Version

**Use TypeScript 6.x or higher**

The project requires the latest TypeScript version for modern features and type safety improvements.

Current requirement: `typescript@^6.0.0`

## Dependencies

### Core Dependencies
- `commander@^12.1.0` - CLI framework

### PPTX Libraries (Peer Dependencies)
- `@deckflow/presentation@^0.3.5` - PPTX reading
- `@deckflow/pptx-modifier@^0.27.0` - PPTX modification

These are optional peer dependencies that need to be installed separately:

```bash
pnpm add @deckflow/presentation @deckflow/pptx-modifier
```

## Build Configuration

- **Module System:** ESM (type: "module")
- **Build Tool:** tsup
- **Target:** ES2022
- **Output:** dist/

## Code Standards

- **Strict Mode:** TypeScript strict mode is enabled
- **Unused Variables:** Not allowed (noUnusedLocals, noUnusedParameters)
- **Type Safety:** Full type coverage required
- **Prefix unused params** with `_` if needed for placeholder implementations

## Testing

- **Framework:** vitest
- **Coverage:** Aim for high coverage of core modules
- **Integration Tests:** Require actual PPTX files

## Git Ignore

Ignored files/directories:
- `node_modules/`
- `dist/`
- `.deck/` and `*.deck/` (workspace directories)
- `coverage/`
- `*.log`

## Scripts

```json
{
  "build": "tsup",
  "dev": "tsup --watch",
  "test": "vitest",
  "test:ui": "vitest --ui",
  "typecheck": "tsc --noEmit"
}
```

## Quick Start

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Clone and setup
cd /Volumes/coding/caixuan/packages/deckuse
pnpm install

# Install PPTX libraries
pnpm add @deckflow/presentation @deckflow/pptx-modifier

# Build
pnpm build

# Test
pnpm test
```
