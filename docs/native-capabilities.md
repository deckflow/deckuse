# Native editing capabilities

These additions use protocol `2.0` and the existing workspace transaction, revision, rollback and export contracts. They are available in Community. Use `deckuse schema --type <command> --json` for exact command shapes. JSON SDK commands include `version`, `workspaceId` and, for writes, `transactionId`. CLI `apply` fills the common write envelope and accepts an array of commands.

## Canvas (N03)

```sh
deckuse new ./letter --width 8.5 --height 11 --unit in
deckuse new ./standard --width 10in --height 7.5in
deckuse new ./wide
```

Both dimensions are required when either is supplied. Lengths must be 1–56 inches. Bare protocol numbers are EMU; string units include in, cm, mm, pt, px and emu. Percentages are rejected. `--unit` requires bare numeric dimensions. This changes the bundled blank template only; arbitrary imported presentations cannot be resized through `init.pageSize`. All slides share one canvas. Mixed PDF pages must use a selected uniform target size with proportional fit and centering; cropping must be explicit.

SDK: `createPresentation(workspace, { pageSize: { width: '8.5in', height: '11in' } })`. Init/status/inspect expose EMU dimensions and aspect ratio.

## Groups (N01)

```json
[
  {
    "type": "groupShapes",
    "slide": 2,
    "targets": ["slide:2/shape:A", "slide:2/shape:B"],
    "name": "Group",
    "zOrder": "preserve"
  },
  { "type": "ungroupShapes", "target": "slide:2/shape:Group" }
]
```

Targets must be distinct siblings on the same slide. Existing groups can become children of a new group. `preserve` requires consecutive sibling shapes; explicit `front`/`back` permits layer changes while retaining internal order. Children are moved as existing XML nodes, preserving IDs, content, styles and relationships. Shape index identity no longer depends on group ancestry; stable UIDs remain tied to the native shape ID. Legacy path references remain resolvable.

Group/ungroup return group/child IDs, UIDs and canonical targets. Ungroup composes translation, rotation, flips and representable scale into children. Shear, inherited group fills/effects, scaled text requiring font materialization, animated group targets and group comment anchors are rejected instead of losing formatting or leaving dangling anchors. Remove group comments explicitly before ungrouping. Empty-group creation remains available.

## Attached connectors (N02)

```json
{
  "type": "addShape",
  "slide": 2,
  "shapeType": "elbow-connector",
  "name": "Link",
  "start": { "target": "slide:2/shape:A", "site": 3 },
  "end": { "target": "slide:2/shape:B", "site": 1 },
  "routing": "auto"
}
```

Binding writes native `stCxn/endCxn`. Rectangles, rounded rectangles, ellipses and diamonds expose sites 0=top, 1=left, 2=bottom, 3=right. Custom paths expose only declared sites. `get` returns endpoints, routing and supported sites. Images, tables, charts and group frames are not supported endpoint nodes. Cross-slide endpoints, self-connections and invalid site numbers are rejected.

`set`/`setProperties` accept `start`, `end`, and `routing`; `null` explicitly detaches an endpoint. `auto` uses the native straight/orthogonal preset routing and resets authored elbow adjustments. `preserve` retains curve/elbow adjustments while moving endpoints. Routing metadata persists in an OOXML extension. Native straight connectors use `straightConnector1`, not a line shape preset. No obstacle avoidance is promised.

Node/group transforms, alignment, group/ungroup and export preserve endpoint attachment and update visible geometry. Deletion defaults to detaching affected endpoints at their last positions with a warning; `remove.connections="reject"` refuses removal instead.

## Chart workbooks (N04/N05)

Set `embeddedWorkbook:true` on chart creation. Default remains false. Supported families are bar, column, line, pie and limited column/bar + line combos. The XLSX contains one `Data` sheet with categories in column A and one column per series. Category, series-name and numeric caches reference the same constant cells. Combo-series order follows the generated chart order, including line-first input.

```sh
deckuse preflight-chart-data slide:2/shape:Chart \
  --properties '{"categories":["A","B"],"series":[{"name":"Sales","values":[3,4]}]}' --json
```

The read-only `preflightChartData` command returns `supported`, current revision, proposed cell changes, and whether chart/workbook isolation is required. Refusal reports stable reason codes and blocking/dependent cell information when available. The actual write rechecks the current workspace under lock; preflight is not a reusable write authorization.

Updates are fixed-length and keep workbook/cache values consistent. Shared chart/workbook resources use existing copy-on-write isolation. Resizing categories, resizing source ranges, adding/removing series and formula-cell writes are rejected.

Unrelated formulas are preserved only when all dependencies can be fully analyzed. The bounded analyzer recognizes direct A1 references/ranges, quoted sheet names and common arithmetic/aggregate functions. A changed constant used by any formula is blocked. Unknown syntax, dynamic references, names, structured references, external dependencies, macros, pivots and unsupported workbook metadata remain conservative refusals. No formulas are evaluated, removed or marked for deferred recalculation.

## Paths and gradients (N06/N07)

```json
{
  "type": "addShape",
  "slide": 2,
  "shapeType": "path",
  "name": "Wave",
  "width": "3in",
  "height": "1in",
  "geometry": {
    "viewBox": { "width": 100, "height": 100 },
    "paths": [
      [
        { "type": "move", "x": 0, "y": 20 },
        { "type": "cubic", "x1": 25, "y1": 100, "x2": 75, "y2": -50, "x": 100, "y": 20 },
        { "type": "line", "x": 100, "y": 100 },
        { "type": "line", "x": 0, "y": 100 },
        { "type": "close" }
      ]
    ],
    "connectionPoints": [{ "x": 100, "y": 20, "angle": 0 }]
  },
  "fill": {
    "type": "linearGradient",
    "angle": 0,
    "stops": [
      { "position": 0, "color": "990099" },
      { "position": 1, "color": "4472C4", "transparency": 35 }
    ]
  }
}
```

Paths support move, line, cubic and close, including multiple open/closed paths. Each path starts with move. Coordinates are finite and must normalize to safe integer DrawingML coordinates. Generated geometry uses a 100000-unit coordinate space; custom connection points use width/height guides so they scale natively. Shapes remain editable in PowerPoint. `setProperties.geometry` updates a regular shape using the same validator. Inspecting unsupported existing custom geometry reports its unsupported coordinate/command representation rather than inventing a lossy path.

Linear gradients support shapes, textboxes, paths and slide backgrounds (`set` target `slide:N`, properties `{fill:...}`). Angle 0 runs left-to-right; 90 runs top-to-bottom. Stops use positions 0–1, ordered nondecreasing, six-digit hex color, and transparency 0–100. Equal stop positions create hard edges. Existing solid fills remain compatible. Path gradients are not added. Unchanged imported gradient XML is preserved.

## Tables (N08)

`addShape.rowHeights` and `setTableLayout.rowHeights` take one positive length per physical row. Explicit row heights cannot be combined with frame height or redistribution. The frame is their sum. Overflow is diagnosed; explicit heights are retained.

```json
[
  {
    "type": "mergeTableCells",
    "target": "slide:2/shape:Table",
    "from": "0:0",
    "to": "0:1",
    "content": "requireEmpty"
  },
  { "type": "unmergeTableCells", "target": "slide:2/shape:Table", "from": "0:0", "to": "0:1" }
]
```

Coordinates are zero-based. Creation-time `merges` and region operations share merge-map generation. Bounds, overlap and partial intersection with existing merges are checked. Default merge requires non-anchor cells to be empty. `content:"append"` moves paragraphs/runs to the top-left in row order. Unmerge retains content in the top-left and retains each physical cell's style; it does not reconstruct prior text locations. Low-level cell merge attributes remain available for compatibility. Commit now rejects incomplete anchors/continuations; construct all required cell edits in one atomic batch or use the region commands. Previously accepted isolated span edits that produced incomplete regions must migrate to a complete batch.

## Preview (R01/R02)

The companion deck2html fixes reflection-dependent anonymous objects that were serialized as `{}` by trimmed native builds. Number-format metadata and series colors now use explicit dictionary graphs. Legend entries bind to unique series names/identities, including duplicate display names, reordered bar series and combo helpers.

HTML exposes chart identity and pending/ready/error states. Deckuse waits for charts in single/batch rendering and propagates initialization failure. Unsupported number formats retain the chart with a degradation warning. `0%` scales by 100; `0"%"` appends a literal percent sign. Verified chart-runtime output suppresses the old blanket color/combo warnings; old converters retain those warnings.

The fixed companion native binary is selected with `DECKUSE_DECK2HTML_BINARY=/absolute/path/to/Deck2Html.Cli`. The existing npm dependency remains the published 0.6.0 until the prepared upstream 0.6.1 patch release is published; do not silently overwrite npm binaries or publish packages as part of local validation. Release order: build/test all target RIDs, publish the companion patch, update Deckuse's dependency/lockfile, repeat the packed-install checks, then publish Deckuse.

## Validation and native acceptance

```sh
pnpm exec tsc
pnpm test
pnpm lint
pnpm test:integration-writes:smoke
DECKUSE_TEST_CONVERTER=/path/to/trimmed/Deck2Html.Cli pnpm test:native-preview
pnpm test:native-office
```

`test:native-preview` pins local ECharts 5.5.1 and tests numeric formats, theme/explicit series colors, duplicate names, bar/line/combo charts, unsupported-format diagnostics, initialization/CDN failures, and Deckuse single/batch propagation. `test:native-office` creates a synthetic file, opens only that file, checks group movement/endpoint attachment, custom connection sites, native freeform/gradient, physical row heights, merged header and native chart type, then closes that presentation without saving. It never closes other PowerPoint windows.

The synthetic fixture is generated under `__temps__/native-capabilities.pptx`, outside the npm package. UI acceptance was also performed on the synthetic fixture: PowerPoint **Edit Data in Excel** opened the actual embedded `Data` sheet (A1:C4); editing a numeric value and category refreshed the PowerPoint chart. The synthetic UI edits were discarded afterward. Native screenshots confirmed the visible geometry, gradient, table merge and chart colors; AppleScript structure checks remain a separate layer of evidence. User documents/raw logs are not added to the package.
