# Preserve an existing file

Required for edit, populate and existing-file audit. Retain the original path, SHA-256, requested change scope and output path. Initialize a new workspace from a copy/reference to that input; never overwrite the original as a side effect.

```bash
deckuse init ./original.pptx ./ws --json
deckuse status --workspace ./ws --json
deckuse export ./baseline.pptx --workspace ./ws --json
deckuse list slides --workspace ./ws --json
deckuse list layouts --workspace ./ws --json
```

For DOCX substitute `.docx` and list paragraphs/styles/tables/bookmarks. `init` and baseline export create task artifacts but should not change the original. For a strict zero-write audit, inspect a copy/package with existing read-only tools instead of initializing beside the original. Do not call repair/undo during an audit without task authorization.

Compare the edited package against the no-edit export baseline as well as the input. ZIP recompression, timestamps and XML serialization may differ without changing content. Compare part presence, relationships, text/whitespace/order, formulas and affected objects before attributing corruption. Preserve unknown parts and shared assets; do not remove an asset solely because one object's reference changed.

Resolve targets from inventory/get/search, check expected matches, then build a bounded operation list. Shape names are convenient but can collide; use returned identities and corroborating properties. Slide indexes can change after insertion/removal: refresh affected inventory. Cache contracts, not positions. After an unreadable write response, compare inventory/history/revision before retrying.

Record whether template inheritance or direct formatting supplies effective properties. Community permits slide layout rebinding, but does not edit master/layout/theme part contents. Do not advertise global theme replacement when only local shapes can be restyled.
