# Installed CLI context

Read once per task. Keep executable/version/schema information separate from dynamic workspace state.

## Load and reuse

On 1.9 or later, load the workflow and its command contracts once:

```bash
deckuse agent-context --format pptx --scenario create --json
```

Use `--workspace ./ws` for an existing workspace and select the matching scenario. For Word use `--format docx` with `create`, `edit`, `audit` or `preview-export`. Cache static contracts by executable and capability fingerprint. Read live revision and targets before each write. For PPTX creation, start with `data.applyContract` for copyable CLI operations, geometry units, text and style examples. Use v2 `operationFields` to find additional top-level fields by name. Query `schema --type addShape --field blocks --json` for one dereferenced field, or `schema --type <operation> --json` for the complete operation, or request `--include-schema` for the complete scenario contract. Run an explicit render preflight to check the environment. For older releases, use the fallback below.

Use `search` or `list` for offline inspection. `find` requires `TYPESAFE_API_KEY` and sends the query and candidate names, visible text excerpts, and layout context to `api.typesafe.ai`. Use it when the task permits sending this content to the service.

Use an existing task snapshot if it matches the selected executable, release/edition and format. Otherwise collect `deckuse --version` and `deckuse schema --json`, saving full stdout/stderr/exit code separately. The schema envelope contains `cliVersion`, `protocolVersion`, `edition`, and `schema`. It lists protocol operations, not proof of every edition/format capability. Keep the complete schema on disk and extract only task-relevant definitions into context.

Optional helper (replace SKILL_ROOT and TASK_CONTEXT with absolute paths already known to the host; do not literally execute placeholders):

```text
python3 SKILL_ROOT/scripts/load_context.py --scenario create --format pptx --cache-dir TASK_CONTEXT
```

The helper prints the selected workflow, observed metadata, supported schema types and paths to sliced contracts. It also returns `operationFields`: top-level fields, required fields and the additional-properties policy for each selected operation. This is an index, not a replacement for nested definitions. Constructor fields and setter property keys are distinct: `valueFormatCode` is a chart setter property, not an addShape field. Inspect the returned files locally; same-version changes of scenario do not require another schema CLI call. `--types` adds operation types for a particular task. `--refresh` replaces a stale/corrupt snapshot after explicit re-query. The helper uses Python 3's standard library; without Python, capture the two CLI results using the host's process tools and inspect the saved schema directly.

Check `contractReady` and `requiredTypesMissing` before using a recipe. `ok` means the schema collection succeeded, not that the installed edition/format can execute every operation. Missing optional `--types` are listed separately; fetch a supported alternative rather than inventing a command. Workspace capabilities and actual execution diagnostics remain authoritative.

Cache invalidation: reselecting a binary, version/edition changes or an explicit refresh trigger collection. The key includes executable identity and nearby installed package/schema fingerprints when available. It is a convenience cache, not a cryptographic attestation of every installed dependency. Recheck dynamic environment state if browser, fonts or host permissions change. No environment launch probe occurs here.

## Actual invocation forms

```bash
deckuse new ./ws --format pptx --json
deckuse init ./input.pptx ./ws --json
deckuse status --workspace ./ws --json
deckuse list slides --workspace ./ws --json
deckuse list shapes --slide 1 --workspace ./ws --json
deckuse apply --workspace ./ws --input ./ops.json --json
deckuse validate --workspace ./ws --json
deckuse render --workspace ./ws --all --output-dir ./review --json
deckuse export ./output.pptx --workspace ./ws --json
```

These are individual commands, not a shell pipeline. The host should capture each process independently. `apply`'s positional argument is a workspace, not the JSON input file. Export requires an output path. `help` and `version` are textual displays even with JSON requested. Protocol schemas may require `version/workspaceId/transactionId`; high-level JSON files consumed by CLI apply receive execution metadata from the CLI, as shown in the bundled examples. Do not strip fields from direct SDK calls on that basis.

`status.data.capabilities`, actual format, `health`, revision and inventory are live workspace facts. Read them after init/new and when relevant state changes. Read `data.valid`/diagnostics as well as envelope `ok`. In 1.7.0, revision representations differ across layers: normalize for comparison, retain the original value and use a current `--expect-revision` for writes. Do not infer schema absence from a shortened help example.

When an older/unrecognized CLI lacks a command/field, inspect its saved contract or make one targeted help/schema query. Mark unsupported operations accurately; upgrade only within the user's installation authorization. Do not repeatedly try guessed flags. Use host tools for PDF extraction and OCR.

Use `render --preflight --json` for static checks. When the installed CLI exposes `render --install-browser`, default selection tries the matching Playwright Headless Shell first and looks for system Chrome, Edge, or Chromium if the shell is missing. The explicit install command downloads the matching shell when the user authorizes installation. On older versions, check `render --help` for supported providers and select a host-approved browser explicitly. Font-risk diagnostics are additional review cues, not proof of installed-font absence or complete visual content. Protocol 2.0 adds comments/revisions operations: load their actual selected schemas and installed review guidance for those requests; ordinary text edits do not constitute accepting/rejecting tracked revisions.
