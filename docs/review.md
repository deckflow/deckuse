# Native notes, comments, and tracked revisions

Deckuse edits OOXML directly. Comments and tracked changes use the same protocol
2.0, workspace lock, optimistic concurrency, atomic `apply`, validation, history,
and undo as ordinary edits. A workspace `revision` is a commit counter; a native
Word `TrackedRevision` is an individual pending review record.

## Comments

Both adapters expose `listComments`, `getComment`, `addComment`, `updateComment`,
`replyComment`, `resolveComment`, `reopenComment`, `deleteComment`, and
`upgradeComments`. CLI subcommands are under `deckuse comments`.

```sh
deckuse comments add --workspace ./work --json \
  --author '{"id":"alice","name":"Alice"}' \
  --anchor '{"target":"slide:1"}' --text 'Please check the figures'
deckuse comments list --workspace ./work --json
deckuse comments reply '<comment-id>' --workspace ./work --json \
  --author '{"id":"bob","name":"Bob"}' --text 'Checked'
deckuse comments resolve '<comment-id>' --workspace ./work --json
deckuse comments reopen '<comment-id>' --workspace ./work --json
deckuse comments delete '<root-id>' --thread --workspace ./work --json
```

Authors are explicit document identities, not authenticated users. Writes support
plain text with multiple paragraphs. Existing rich content and extensions remain
in place until the specific comment body is edited. Unsupported complex Word
comment bodies fail explicitly. Root deletion requires `thread: true`; a reply
with child replies cannot be deleted independently. Resolved or unknown-state
threads must be reopened before replying.

PPTX new comments default to modern format. A legacy-only file continues to use
legacy comments until explicit `comments upgrade`. Legacy comments support
reading, adding, updating, and deleting, with slide-position anchors; replies and
resolved state require modern comments. Mixed files require `format` on creation.
Upgrade is atomic, retains native author/time/text/position information, and
returns the old/new ID mapping. Unknown legacy extensions block conversion.

Word replies use commentsExtended, durable IDs, identities, and body references
for every reply. Blank documents declare compatibility mode 15. Existing older
compatibility modes are preserved; use explicit `comments upgrade` to enable
modern Word threading. This operation changes compatibility settings and can
change the way an old document lays out in Word.

## Anchors and lifecycle

An anchor is `{ target, start?, end?, x?, y? }`. Text endpoints are
`{ target, offset }`, with zero-based UTF-16 offsets; surrogate splits and reversed
ranges are rejected. DOCX supports body paragraphs, cross-paragraph ranges in one
text region, and ranges within a single table cell. PPTX supports slides, shapes,
and shape text ranges; coordinates are EMUs. Word fields, equations, content
controls, and existing protected ranges are not rewritten to create anchors.

IDs are opaque and scoped to the package and native part/identifier. Refresh IDs
following external Office saves or structural changes. Unresolved native anchors
are returned without guessing a nearby target. Auxiliary Word stories can be
read but are not semantic write targets.

Ordinary edits that can invalidate an anchor are rejected. Word `replaceText`
checks touched runs, allowing edits outside anchored ranges. Whole text rebuilds
remain conservative. PPTX geometric moves preserve object anchors. Deletion of
commented slides/objects requires deleting threads first or explicit
`commentsPolicy: "delete"` (`remove --comments-policy delete`). Unknown object
anchors must be removed explicitly. Group deletion also checks descendant anchors.

Slide copies receive separate comment parts and fresh native IDs. Relationships,
slide monikers, and legacy author counters are updated. Use
`{ "type":"duplicate", "target":"slide:1", "commentsPolicy":"omit" }` in `apply`
to omit comments. Unknown anchors block unsafe copies.

Speaker notes keep the existing `slide:N/notes` addressing. Only a unique notes
body is edited. Decorative placeholders and unknown notes XML are retained; new
notes reuse a unique existing notes master.

## Tracked changes

```sh
deckuse revisions list --workspace ./work --json
deckuse revisions get '<tracked-id>' --workspace ./work --json
deckuse revisions view --view original --workspace ./work --json
deckuse revisions view --view final --workspace ./work --json
deckuse revisions view --view markup --workspace ./work --json
deckuse revisions propose --input proposal.json --workspace ./work --json
deckuse revisions preview --decision accept --all --workspace ./work --json
deckuse revisions accept --all --workspace ./work --json
deckuse revisions reject --ids '["<tracked-id>"]' --workspace ./work --json
```

Example `proposal.json`:

```json
{
  "author": { "id": "alice", "name": "Alice" },
  "operations": [
    {
      "op": "replaceText",
      "start": { "target": "body/p:1", "offset": 0 },
      "end": { "target": "body/p:1", "offset": 5 },
      "text": "Hello"
    }
  ]
}
```

Proposal operations:

| Operation                            | Input beyond `op`                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `replaceText`                        | `start`, `end`, `text`; one paragraph or continuous paragraphs in one region |
| `setProperties`                      | `target`, `properties`; existing character/paragraph property API            |
| `insertParagraph`                    | `target`, `text`; inserts after target                                       |
| `deleteParagraph` / `mergeParagraph` | `target`; merge removes the following paragraph boundary                     |
| `splitParagraph`                     | `target`, `offset`                                                           |
| `moveParagraphs`                     | `target`, `endTarget`, `after`; continuous body paragraphs in one section    |
| `insertRow` / `deleteRow`            | table `target`, zero-based `index`                                           |
| `insertColumn` / `deleteColumn`      | table `target`, zero-based `index`                                           |
| `mergeCells` / `splitCell`           | table `target`, zero-based `row`/`column`, vertical `count`                  |

Inserted rows/columns start empty and inherit local structure. Structural table
proposals require regular grids; vertical splitting requires the complete merge
group. Merge proposals track both cell structure and text migration, preserving
continuation-cell content when Word accepts the change. Splitting restores
separate cells; it does not guess a redistribution of merged text. Horizontal or
arbitrary rectangular merge/split, irregular/nested tables, cross-section moves,
and cross-cell/cross-story ranges fail explicitly.

Pending revision intersections are protected. Full paragraph reconstruction is
conservative; settle existing revisions before proposing another change in that
paragraph. Normal editing continues to make direct changes unless `proposeChanges`
is used. Simply enabling Word's track-changes setting is not used as a substitute
for writing native revision elements.

Views are non-mutating projections with text, XML, opaque structures, and a
`complete` flag. Inventory includes native metadata, location, old/new property
snapshots, raw XML, and per-record capabilities. Unknown or nested structures are
preserved and cannot be silently accepted/rejected. Headers, footers, notes,
comments, and text boxes are inventory/projection-only.

Decisions require explicit IDs or `all: true`. Preview checks dependencies,
malformed ranges, read-only stories, comments, and whether the decision can be
projected safely. Incomplete groups return `requiredIds`. Deckuse-generated
operation groups and fingerprints are stored in a small custom XML part while the actual revision
semantics remain native OOXML. Named native move ranges are also grouped. Uncertain partial decisions after external edits are refused; an explicit all-selection can settle supported revisions. No
relationship between arbitrary independent insertions/deletions is guessed.

## Transactions and verification

Protocol review writes require `transactionId` and `expectRevision`. CLI commands
capture the current revision when no explicit guard is supplied. Review writes
can also be supplied as high-level JSON/JSONL commands to `apply --input`; a single
`proposeChanges` object retains its own nested `operations` array. Failed batch
writes and dry runs leave source, snapshots, manifest, and history unchanged.

Automated checks cover schema, both comment adapters, source preservation,
protected ranges, UTF-16, projections, native decisions, CLI, atomic rollback,
optimistic conflicts, and undo. Real Word 16.78 save results are captured in
`test/fixtures/review/word-16.78-decisions.json` and checked semantically. Word may
add an empty terminal paragraph after a table; this normalization is excluded
from those comparisons. See `review-implementation-status.md` for native Office
verification evidence and its precise limits.
