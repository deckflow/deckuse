# Changelog

## [Unreleased]

### Changed (2026-03-31 - Part 2)
- **Removed Indexes**: Simplified metadata structure by removing separate indexes
  - All data now comes from `results` (single source of truth)
  - No more duplication between indexes and results
  - Commands query results directly via helper methods
  - Updated: Workspace, Selector, all commands
  - Benefits: Simpler, no sync issues, more flexible

### Fixed (2026-03-31 - Part 1)
- **Init Command Hanging**: Fixed init command hanging when parsing PPTX files
  - Corrected loading order: masters → layouts → slides (was causing "Slide lack slideLayout" error)
  - Fixed slideLayouts type handling (Map vs Object)
  - Removed debug logs, kept clean output
  - See `BUGFIX_INIT_HANG.md` for details

### Added (2026-03-30 - Part 2)
- **Metadata Results Node**: Added `results` field to workspace metadata
  - Stores complete parsing results from @deckflow/presentation
  - Includes presentation, slides, slideMasters, and slideLayouts
  - Enables caching and advanced operations

- **PPTX Reader Integration**: Implemented @deckflow/presentation integration
  - Added `parseFromFile()` method to parse PPTX files
  - Parse and cache complete presentation structure on init
  - Build indexes from parsing results

- **Documentation**:
  - Created `docs/METADATA_STRUCTURE.md` - Metadata design and rationale
  - Created `docs/IMPLEMENTATION_STATUS.md` - Detailed implementation status
  - Updated `DEVELOPMENT.md` with metadata reference

### Changed (2026-03-30 - Part 1)
- **Package Manager**: Migrated from npm to pnpm
  - Added `.npmrc` configuration
  - Updated all documentation to use pnpm commands
  - Added `packageManager` field to package.json
  - Added pnpm engine requirement (>=9.0.0)

- **TypeScript**: Upgraded to TypeScript 6.0.2
  - Added `ignoreDeprecations: "6.0"` for TS6 compatibility
  - Added explicit `types: ["node"]` configuration
  - Maintained strict mode and all type safety features

- **Dependencies**: Successfully installed PPTX libraries
  - `@deckflow/presentation@0.3.5` (peer dependency)
  - `@deckflow/pptx-modifier@0.27.0` (peer dependency)

### Added
- `PROJECT_RULES.md` - Project conventions and standards
- `.npmrc` - pnpm configuration
- Memory files for project configuration rules

### Fixed
- Build now works with TypeScript 6.0.2
- All tests passing with new setup

## [0.1.0] - 2026-03-30

### Added
- Initial project structure and configuration
- Core workspace management system
- Selector parsing and resolution
- CLI interface with commander
- 11 commands (init, status, commit, list, show, get, set, replace)
- Comprehensive type definitions
- Error handling system
- Unit tests for core modules
- Documentation (README, DEVELOPMENT, PROJECT_STATUS)

### Infrastructure
- TypeScript + ESM configuration
- Build system using tsup
- Test framework (vitest)
- Git configuration

### Notes
- PPTX reader/writer have placeholder implementations
- Integration tests skipped pending library implementation
