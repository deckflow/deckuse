# Export an existing DOCX

Required modules: [CLI context](../modules/cli-context.md), [Verification/recovery](../modules/verification-recovery.md). If starting from an existing file, also use [Preservation](../modules/preservation.md).

Reuse the supplied Word workspace, or initialize a preserved input into an isolated task workspace. Read status and validate structure. Export to an explicit new `.docx` path without applying content changes:

```bash
deckuse status --workspace ./ws --json
deckuse validate --workspace ./ws --json
deckuse export ./output.docx --workspace ./ws --json
```

Check process/envelope/data validation and output existence. Snapshot staleness may require normal export rebuilding from source; `--from-package` copies the snapshot instead. Neither choice calls for changing document text.

In 1.8.0, use `deckuse render --workspace ./ws --all --output-dir ./review --json` for approximate HTML pagination when a host-approved browser is configured. Verify the installed version before using this on older releases. Inspect actual pages and preserve font diagnostics. Native Word page count and PDF export still require an available authorized native/export path; HTML pages do not establish native layout. State native/layout checks only when performed.
