# Native editing implementation status

See [native-capabilities.md](native-capabilities.md) for the implemented N01–N08 / R01–R02 contracts, support boundaries, runnable verification and release sequencing.

Local verification includes native PowerPoint group movement with both endpoint bindings preserved, editable freeform geometry, custom connection sites, native gradient, exact table row heights, merged header and chart recognition. The real trimmed converter passes the local-browser preview matrix and Deckuse single/batch failure propagation.

Distribution is not published: the companion patch must be released before replacing Deckuse's published 0.6.0 dependency. The explicit `DECKUSE_DECK2HTML_BINARY` selector supports local/packaged testing in the meantime. PowerPoint Edit Data UI inspection also passed: the actual embedded worksheet opened in Excel and both category and value edits refreshed the native chart. Synthetic UI edits were discarded.
