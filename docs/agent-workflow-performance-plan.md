# Agent workflow performance plan

## Evidence and scope

Scope: Deckuse CLI, packaged runner and skill. Do not change the host agent,
publish user logs, or weaken revision guards, host policy or visual review.
The reviewed 1.9.6 run made 11 slides with 210 creation operations and 16 text
replacements. It took 23m32s end to end; tool execution windows overlapped and
their union was 7m01s. These are host observations, not CPU benchmarks.

The supplied workspace has exactly an initialization and two content commits.
Both original apply reports contain post-commit cleanup warnings; later results
are receipt replays with report-path collisions. This is not evidence that
dry-run committed. The precise host retry trigger remains unverified.
Ten searches used the wrong response field; five second-pass PNGs are identical
to the first pass. All 16 original strings remain in the generator although
the final document contains the patched text. Font and native Office verification
remain unknown/unverified. No speedup claim is supported yet.

## Delivery sequence

1. **Recovery and observable results.** Reuse a report only when a replay's
   identity and committed result match it. Never overwrite unrelated reports.
   Expose report status separately from mutation success. Preserve original
   cleanup evidence. Fix replaceText changed-target aggregation and provide
   compact per-batch match counts. Test replay, conflicting reports and no-op.
2. **One-snapshot verification and contract discovery.** Add strict PPTX text
   assertions to validate, with counts per text object and revision binding.
   Add a dereferenced field schema query and response contracts to agent-context.
   Missing response fields must never become silent zero matches.
3. **Reproducible generation.** Extend the existing generation runner to save
   ordered base/patch inputs and compile them into the exact operations applied.
   Resume verifies input digests. Rebuilding the recipe must retain final text.
   Use existing incremental render support; do not add another renderer.
4. **Skill adoption.** Lead creation with the runner and a small operation recipe,
   retain progressive schema discovery, document response checks and incremental
   preview. Preserve semantic qualifiers when correcting layout. Distinguish
   structure, rendered layout, font and native verification.
5. **Measurement and later optimization.** Use a synthetic 11-slide/210-operation,
   16-replacement regression workload with no user paths or health claims. Record
   cold/warm CLI phase timings and fixed-input replay separately from agent E2E.
   Only consider startup, indexing or converter changes after profiling. Diagnostic
   threshold/font-resolution changes require labeled rendering samples first.

## Acceptance gates

- Dry-run leaves content and revision unchanged; a replay makes no new commit.
- Same-request report reuse preserves original bytes; unrelated files stay intact.
- All modified text targets and zero/multiple matches are observable.
- A single validation checks required/absent strings; malformed assertions fail.
- Base plus ordered patches rebuild final text; altered saved inputs block resume.
- First-pass pages are reviewed; follow-up previews reuse verified unchanged pages.
- Passing structure does not imply font/native verification or visual approval.
- Build, type/lint checks, focused fault/recovery tests and package checks pass.

## Execution record

- Base: 1ca2608 (1.9.7); isolated branch `codex/agent-workflow-performance`.
- Default owned-artifact retirement already exists; reuse and regression-test it.
- Implemented stages 1–4: bound report reuse and original warning visibility,
  replacement target/match summaries, `validate --assert-text`, dereferenced
  `schema --field`, response contracts, ordered runner patch inputs with resume
  digest checks, and focused skill guidance. Existing incremental renderer reused.
- Added synthetic `--scenario eleven-slide` to the replay benchmark: 11 pages,
  210 operations / 200 objects, 16 replacements affecting pages 2,4,5,6,7,8.
- Three fixed-input trials on Node 24.14.1, macOS: original command sequence median
  5421 ms; candidate 5413 ms. No material engine speedup is established.
- Ten text checks plus structural validation: baseline 11 CLI calls, median
  4209 ms; candidate one assertion-aware validation, median 493 ms (88.3% lower).
  This is local process timing, not a claim about end-to-end agent latency.
- Build, full lint, commercial-leak check, focused recovery/generation/render tests,
  and npm pack/install smoke validation pass. Skill links and packaged runner pass.
  The generic skill-creator validator rejects the pre-existing `compatibility`
  frontmatter field; the entrypoint was not changed to satisfy that narrower schema.
- Remaining measured follow-up: multi-host/model agent trials; real-browser cache
  timing; labeled font/clipping diagnostics before any threshold changes. Do not
  change font detection or add a daemon based on this one trace.
- Implementation was validated in an isolated worktree; raw user logs and local
  benchmark artifacts are excluded from the change.

### Reproduce the benchmark

After building baseline and candidate packages with the same Node runtime:

```sh
node scripts/benchmark-managed-replay.mjs /absolute/baseline/dist/bin.js ./dist/bin.js /new/report.json --scenario eleven-slide
```

Add `--preview` only with a configured, permitted browser to verify first-pass
and incremental screenshots. Report timing distributions and validation outcomes
alongside speed; the fixture has synthetic neutral content and no user paths.
