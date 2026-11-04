# Review implementation and verification

## Delivered

- PPTX notes: unambiguous speaker-body selection, notes-master reuse, existing
  creation/copy/delete/relationship-repair integration.
- PPTX comments: legacy/modern readers and writers, authors, threads, replies,
  resolve/reopen, explicit conversion, slide/shape/text anchors, independent slide
  copies, explicit deletion/omission policy, and descendant-anchor protection.
- DOCX comments: native ranges/references, reply references, paragraph identities,
  commentsExtended/commentsIds/commentsExtensible/people, body updates, thread
  deletion, resolve/reopen, and explicit legacy compatibility upgrade.
- Revisions V1: namespace-aware detection and inherited protection for text,
  properties, paragraphs, ranges, and table structures. Unknown revision-like
  markup fails closed. Auxiliary stories remain read-only.
- Revisions V2: inventory, XML/location/property snapshots, original/final/markup
  projections, completeness reporting, dependency closure, and decision previews.
- Revisions V3: text and formatting, paragraph changes, paired body moves, regular
  row/column changes, reversible vertical merge/split, and atomic native
  accept/reject. Arbitrary rectangular merging was explicitly excluded by the user.
- Additive protocol 2.0 schemas, CLI, generated JSON Schema, public types, capability
  metadata, versioned derived indexes, default Word template, docs, and agent guidance.

See [review.md](review.md) for interfaces, examples, and supported boundaries.
No package publication or production deployment was performed.

## Native Office evidence

Environment: macOS, Microsoft Word 16.78 and Microsoft PowerPoint 16.78.

- Word opened generated text revisions and displayed one insertion and one
  deletion with the correct author/content. Native acceptance, save, and Deckuse
  re-read produced the expected final text and zero pending revisions.
- Word opened the structural sample set without repair prompts. Real native
  acceptance/save results for row insertion/deletion, column insertion/deletion,
  character/paragraph formatting, paired moves, paragraph splitting, and vertical
  merging are checked against Deckuse in eight regression cases. A ninth case
  compares native rejection of paragraph splitting.
- Native merge testing caught continuation-cell content loss when using merge
  markers alone. The implementation now records content migration as grouped
  native insertion/deletion revisions; Word acceptance preserves all content and
  matches Deckuse's output.
- Word opened root comments in resolved and reopened states. After adding native
  references for replies, Word displayed the reply, allowed editing it, and saved
  it; Deckuse re-read the updated reply and parent relationship correctly.
- PowerPoint opened a newly created notes part without repair, displayed the
  speaker notes, and saved an edited notes body that Deckuse re-read correctly.
- PowerPoint opened a generated modern comment without a repair prompt, displayed
  its author and text, accepted a native reply, and saved it. Deckuse re-read the
  correct parent/thread relationship after PowerPoint renamed the comment part.

These observations validate the exercised desktop flows, not every Office build
or arbitrary imported document. Native UI tests are not silently replaced by
LibreOffice conversion. Exact Office-generated document XML decision fixtures
are committed without account/profile metadata.

## Automated verification

Final verification on 2026-11-04: build and lint passed; all 48 test files and
340 tests passed. The packaged-agent resource/workflow check, skill validator,
and isolated PPTX/DOCX integration-write smoke cases (2/2) also passed. Formatting
and `git diff --check` passed. An existing monitor test now waits for the
post-conversion cache check before changing the package, eliminating a race in
its watcher-filtering assertion without changing monitor runtime behavior.

Run `pnpm build`, `pnpm lint`, and `pnpm test`. The suite includes:

- Native Word decision oracles for text/structure/property semantics.
- Word and PowerPoint comment lifecycle and fidelity tests.
- DOCX optimistic conflicts, dry runs, source/manifest preservation, batch rollback,
  ordinary edits outside anchors, and undo after native review decisions.
- CLI comment threads, single-object proposal `apply`, views, preview, and decisions.
- Existing notes, slide, text, table, package, rendering, schema, and CLI regressions.

Unsupported or uncertain structures are preserved or explicitly refused; the
capability matrix and diagnostics describe those limits. The code is not a full
Word editor or a collaboration/approval service.
