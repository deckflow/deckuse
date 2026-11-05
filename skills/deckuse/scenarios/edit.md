# Edit an existing presentation

Use for bounded changes to an existing PPTX, including restyling and page operations. Preserve unaffected material. A branded template with a small local change belongs here; repeated field mapping belongs to [Populate](populate-template.md).

Required modules: [CLI context](../modules/cli-context.md), [Preservation](../modules/preservation.md), [Verification/recovery](../modules/verification-recovery.md). Load [Typography/layout](../modules/typography-layout.md) or [Charts/tables](../modules/charts-tables.md) when needed.

For nested groups, mixed text runs or chart workbooks, also load [Complex edits](../modules/complex-edit.md).

1. Keep the original hash and create a new task workspace plus no-edit export baseline. Record user-authorized changes and protected content. Inventory slides/layouts and affected objects, including inherited properties and shared assets.
2. Resolve each target using list/get/search. Verify the intended match count and text before writing. Do not select the first shape merely because its name resembles the request.
3. Adapt [edit-pptx.json](../examples/edit-pptx.json); its target is valid only for the bundled create example. Replace with identities obtained from this document. Use `setText`/`setProperties` for narrow edits; duplicate/rebind layout only when required. Do not rebuild the whole deck for a local change.
4. Read current revision, make a dry-run when it helps assess target/data scope, and apply the real batch with an optimistic guard where appropriate. A dry-run does not create shapes for subsequent separate commands to target.

```bash
deckuse status --workspace ./ws --json
deckuse apply --workspace ./ws --input ./ops.json --dry-run --json
deckuse apply --workspace ./ws --input ./ops.json --expect-revision 1 --json
```

The number above is illustrative: use the current observed revision, not a literal `1` in an existing task. A concurrency conflict requires fresh inspection, not removing the guard and retrying blindly.

5. Validate, compare against the no-edit baseline and inspect modified plus potentially affected neighboring pages. For delivery, render/review the complete deliverable when feasible; disclose any unreviewed pages. Check charts/shared media separately.
6. Export to a distinct output path. Confirm original hash unchanged. Report intended changes, preservation check and actual visual/native verification status. If a write response was lost, reconcile before retrying so content is not duplicated.
