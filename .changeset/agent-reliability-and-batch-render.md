---
'@deckflow/deckuse': minor
---

Protect nonempty initialization destinations, recover interrupted PPTX/DOCX persistence, and roll back failed Git writes without discarding manual edits. Ordinary JSON CLI input errors now return an error envelope. Add command-type discovery, save slide names and report final slide identities, and support snapshot-consistent batch rendering with a shared browser or one LibreOffice conversion. Add benchmark telemetry and agent workflow documentation.

Behavior change: new/init refuse nonempty directories. Use a new empty destination instead of overwriting an existing workspace. Protocol remains 2.0.
