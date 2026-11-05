# Complex existing presentations

Load when an existing deck contains nested groups, mixed text runs, charts/workbooks or shared assets. Use the no-edit export as the preservation baseline, because import/export normalization can differ from the original package.

Inventory the affected slide and its actual child targets. A group's aggregate text is not a replacement target for all its children. Use a run target for a local font/color change when mixed formatting must survive; replacing an entire shape's text may change its run structure. Observe group parent/child coordinate transforms before moving a child. For a whole-group translation, modify the existing group frame and verify its children remain intact. Creating an empty group is not grouping existing objects.

Inspect chart capabilities and workbook dependencies before promising a data edit. A real 49-slide presentation refused a constant-looking series update because its workbook had unsupported formula dependencies. The refusal was valid and the entire batch rolled back. A title-only change was supported while preserving original values. Never bypass this refusal with chart-cache-only or raw XML writes. If the required data change is blocked, report it; a safe independent cosmetic change does not satisfy that requirement.

Keep interdependent edits in one transaction. After a refusal or timeout, reconcile revision, inventory and relevant part hashes before proceeding. Split out independent supported work only when it remains within the user's intended scope, preserving the refusal evidence and pending requirement.

For bounded edits, compare source-part hashes against the no-edit baseline and explain the changed-part set. Check untouched slide XML, media, relationships, masters/layouts and embedded workbooks as applicable. Do not claim all slides were visually reviewed because their XML was unchanged. Review modified and affected pages side by side; retained chart data and successful export do not prove correct preview or native PowerPoint behavior.
