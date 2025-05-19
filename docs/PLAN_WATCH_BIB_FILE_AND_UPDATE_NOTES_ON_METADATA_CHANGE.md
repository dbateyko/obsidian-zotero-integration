# Plan: Watch `.bib` File and Update Notes on Metadata Change

This document outlines approaches for:

1. Monitoring the user's Zotero export `.bib` file (e.g., `references.bib`) for changes.
2. Propagating metadata updates from the `.bib` file into existing Markdown notes in the Obsidian vault.

---

## Part 1: `.bib` File Watcher

**Goal**: Automatically detect when the configured Better BibTeX `.bib` file is added, modified, or deleted, and trigger the metadata sync workflow.

### Approach A: Native Node.js `fs.watch` API **(SELECTED)**

- **Concept**: Use `fs.watch` to register a watcher on the target `.bib` file path.
- **Implementation**:
  1. In plugin settings, allow user to configure `betterBibFilePath`.
  2. On plugin load (or when settings change), call `fs.watch(betterBibFilePath, { persistent: true }, handler)`.
  3. Debounce rapid successive events (e.g., 300–500 ms) before scheduling a sync.
  4. In `handler`, check event type (`change`, `rename`): on `change`, re-read file; on `rename`, re-establish the watcher if file was recreated.
- **Pros**: Minimal overhead; built-in API; event-driven.
- **Cons**: Platform-specific quirks (missing `rename` on some OSes); requires manual fallback on delete/rename.

### Approach B: Third-Party Library `chokidar` *(not selected; for reference)*

- **Concept**: Leverage `chokidar` for a robust cross-platform watcher with auto-retries.
- **Pros**: Handles edge cases (file moves, atomic saves); supports polling fallback.
- **Cons**: Additional dependency; larger bundle size (~1 MB+); slightly higher memory footprint (~5–10 MB).

### Approach C: Polling via `fs.stat` / `fs.watchFile` *(not selected; for reference)*

- **Concept**: Periodically check the file's mtime using `fs.stat` or `fs.watchFile`.
- **Pros**: Works uniformly across platforms.
- **Cons**: Higher CPU overhead proportional to poll frequency; delays in detection based on interval.

### Resource Usage Estimate

- **Native `fs.watch`**: CPU (idle) < 0.1 %; Memory footprint < 5 MB.
- **`chokidar`**: CPU (idle) < 0.2 %; Memory footprint ~ 5–10 MB.
- **Polling (`fs.watchFile`)**: CPU ~ 0.2–1 % (depends on interval); Memory footprint < 5 MB.

---

## Part 2: Updating Notes on Metadata Change

**Goal**: Reflect updated metadata from the `.bib` file into existing Markdown notes corresponding to each citation key.

### Strategy A: Incremental Frontmatter Patch **(SELECTED)**

- **Concept**: Parse YAML frontmatter of each note, diff fields against new metadata, and patch only changed keys.
- **Implementation**:
  1. Maintain a map of `{ citeKey: metadataObject }` from last sync.
  2. After reading updated `.bib`, compute diff between old and new metadata for each key.
  3. For each changed entry:
     - Load the note file (identified by citeKey).
     - Parse frontmatter (e.g., using a YAML parser such as `gray-matter`).
     - Update only the fields that have changed.
     - Write back the frontmatter while preserving other content.
- **Pros**: Minimal disruption to user-edited content; only necessary I/O.
- **Cons**: Requires reliable frontmatter parsing/writing; edge cases if frontmatter is manually edited.

### Strategy B: Full Note Regeneration via Template *(not selected; for reference)*

- **Concept**: Re-render the entire note from a template based on fresh metadata.
- **Pros**: Guarantees consistency; leverages existing templating engine.
- **Cons**: Overwrites user customizations; risk of data loss.

### Strategy C: Change Log File with Manual Review *(not selected; for reference)*

- **Concept**: Generate a diff-style change log and let users review/apply updates manually.
- **Pros**: Zero automatic writes; user fully in control.
- **Cons**: Defeats automation goal; poor UX.

---

## Recommended Next Steps

1. Extend plugin settings to include `betterBibFilePath` and sync options (debounce delay, enable/disable auto-sync).
2. Implement the native `fs.watch` watcher with debounce and automatic re-registration on file rename.
3. Build the incremental frontmatter patcher:
   - Leverage `gray-matter` (or similar) to parse/write YAML frontmatter.
   - Diff old/new metadata maps.
4. Add tests for detecting file events and frontmatter updates.
5. Surface UI feedback:
   - Notification when auto-sync runs;
   - Errors on parse or I/O failures.
6. Update `README.md` or relevant docs with configuration and behavior of the auto-update feature.

*This plan file was generated to guide development of the `.bib` watcher and metadata sync workflow.*