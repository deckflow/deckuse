# Changelog

## [Unreleased]

### Changed (2026-03-30)
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
