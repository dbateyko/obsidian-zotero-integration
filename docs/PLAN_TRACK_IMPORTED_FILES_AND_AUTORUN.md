# Plan: Track Imported Files and Enable Autorun on Startup

This document outlines multiple approaches for enhancing the Zotero Integration plugin to:

1. Track which files (e.g. PDFs, Markdown notes, attachments) have already been imported from a Zotero collection or .bib export, avoiding redundant work and overwriting existing files.
2. Automatically trigger the collection import process when Obsidian starts (autorun), instead of requiring manual invocation.

---

> **Selected Strategies**
>
> - **Tracking Imported Files**: Approach A (Persistent Import Registry)
> - **Autorun Import on Startup**: Option B (Debounced Startup Command with Zotero check)

## Part 1: Tracking Imported Files

We consider three different strategies to record and check which items have been imported.

### Approach A: Persistent Import Registry (in Plugin Settings) **(SELECTED)**

- **Concept**: Maintain a map in the plugin's persisted settings or data store that records the unique keys or file paths of imported items.
- **Implementation**:
  1. Extend the plugin settings object (or use the `this.plugin.saveData()` API) to include a field like `importedItems: Record<string, string>` where the key is a citation key or item ID and the value is the file path created in the vault.
  2. Before importing each item, check if `importedItems[citeKey]` exists. If so, skip re-import.
  3. After a successful import, add an entry to the registry and persist settings/data.
  4. (Optional) Track metadata (e.g., last-import timestamps or file-watch events) to enable pruning stale entries or updating registry when files are moved/renamed by users.
- **Pros**: Fast lookups; simple to serialize; independent of file system state.
- **Cons**: Registry may grow unbounded without pruning; additional persistence overhead in plugin data; moved/renamed files won't update registry automatically unless pruned or synced.

### Approach B: Frontmatter or Marker Comment in Generated Files *(not selected; for reference)*

- **Concept**: Embed a unique identifier (citation key or UUID) in the frontmatter (YAML) or as a comment in each generated Markdown or attachment file.
- **Implementation**:
  1. When generating a note (or saving an attachment), insert a line like `citekey: smith2021` in the YAML frontmatter or `<!-- citekey: smith2021 -->` at the top.
  2. On subsequent runs, scan the target folder for files and parse the frontmatter/comment blocks to collect existing cite keys.
  3. Skip importing any cite key already present in scanned files.
- **Pros**: Files are self-describing; no external registry needed.
- **Cons**: Requires scanning/parsing files on each run, which may be slower on large vaults; frontmatter markers may confuse users editing the note.

### Approach C: File Existence + Naming Convention *(not selected; for reference)*

- **Concept**: Rely on a deterministic naming scheme or hash-based file paths so that a re-import attempt produces the same target path.
- **Implementation**:
  1. Derive file names from citation keys, item titles, or content hashes (e.g., `smith2021.md` or `smith2021-<hash>.pdf`).
  2. Before writing, check `vault.getAbstractFileByPath(targetPath)` or use the Obsidian API to see if the file exists.
  3. If the file exists, skip writing; otherwise, proceed and save.
- **Pros**: No need for extra registry or file parsing; immediate existence check via API.
- **Cons**: If users rename or move files, the plugin won't recognize them as imported; collision handling for duplicate names must be robust.

---

## Part 2: Autorun Import on Obsidian Startup

We consider two strategies to trigger the import workflow automatically when Obsidian activates the plugin.

### Option A: Hook into `onload()` Lifecycle *(not selected; for reference)*

- **Concept**: In the plugin's `onload()` method, after settings and commands are initialized, optionally trigger the import logic if a new `autorunOnStartup` setting is enabled.
- **Implementation**:
  1. Add a boolean setting `autorunOnStartup` to plugin settings.
  2. In `onload()`, after registering commands, check `if (settings.autorunOnStartup) { await runCollectionImport(); }`.
  3. Provide a notification or console log summarizing the import results.
- **Pros**: Simplest to implement; leverages existing lifecycle hooks.
- **Cons**: May block startup if many items to import; impacts perceived startup performance.

### Option B: Debounced Startup Command **(SELECTED)**

- **Concept**: Delay autorun slightly to let Obsidian fully initialize UI and vault, then trigger import (e.g., via `setTimeout`).
- **Implementation**:
  1. After `onload()`, wrap the import trigger in a small timeout (e.g., `setTimeout(() => runCollectionImport(), 5000)`), controlled by `autorunOnStartup`.
  2. Optionally show a non-modal notification when import begins.
  3. Before triggering import, verify Zotero is running and responsive (e.g., via local API port or process check); if not available, skip autorun and log a warning.
- **Pros**: Avoids blocking startup; gives users time to cancel or see UI.
- **Cons**: Complexity in debugging timing; may still run even if user is not ready.

---

## Recommended Next Steps

1. **Implement Persistent Registry**: Extend plugin data (via `saveData()`) to record imported item keys and paths.
2. **Prototype & Validate**: Wire up the registry check in the import workflow and validate skipping of already-imported items.
3. **Implement Debounced Autorun with Zotero Check**: Add the autorun-on-startup toggle, debounce trigger logic, and a runtime check to confirm Zotero availability before import.
4. **Add Settings UI & Migration**: Surface the autorun setting and consider a migration path for existing users (e.g., import an initial registry snapshot).
5. **Update User Documentation**: Revise README/docs to reflect the new registry mechanism, autorun behavior, and troubleshooting steps if Zotero is not running.

*This plan file was generated to guide development of import tracking and autorun features.*