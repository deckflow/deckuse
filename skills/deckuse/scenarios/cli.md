# CLI questions and diagnosis

Use for syntax, units, capability questions or an explicit request to inspect the installation. This route does not require a document workspace.

Consult already loaded [CLI context](../modules/cli-context.md) or a matching cached contract. If that answers the question, respond directly. For an explicitly requested live check, use read-only `--version` or schema discovery once and explain the actual version/edition. Do not create a document merely to answer a capability question.

If the user forbids file creation, do not invoke the helper with a new cache directory: use already loaded information or capture a read-only CLI response through the host. Clearly distinguish an untested capability statement from an executed operation. An installed command is not a guarantee that every format/edition/target permits it.

For an execution failure, load [Verification/recovery](../modules/verification-recovery.md), retain the actual stdout/stderr/exit, and diagnose its layer. Do not reproduce a failed write unless the task authorizes that mutation. Installation, upgrade and browser launch are separate actions from reading current capabilities; follow existing task authorization.
