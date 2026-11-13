---
'@deckflow/deckuse': patch
---

Add `deckuse render --install-browser` to install the Chromium Headless Shell for the current Playwright dependency. When the default shell is missing, look for system Chrome, Edge, or Chromium. Include the install command in missing-browser errors and report the selected browser in probe results.
