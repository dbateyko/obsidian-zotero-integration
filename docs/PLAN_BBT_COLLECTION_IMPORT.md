# Plan: Import Zotero Collection via Better BibTeX .bib Export

This document outlines a plan for adding a new "Import Zotero Collection (Better BibTeX .bib)" command to the Obsidian Zotero Integration plugin. The goal is to allow users to point the plugin at an actively maintained Better BibTeX `.bib` file exported from Zotero and have the plugin iterate all citation keys to generate Markdown notes based on their annotations.

## Overview

Users can export a dynamic Zotero collection using the Better BibTeX plugin to a `.bib` file that updates automatically when the collection changes. The new plugin command will:

1. Read the configured `.bib` file.
2. Parse all citation keys in the file.
3. For each key, invoke the existing export-to-Markdown logic (via `exportToMarkdown`/`runImport`).
4. Collect and open the generated Markdown notes (based on user settings).

## Proposed Changes

### 1. Add a new plugin setting

- **Key**: `betterBibFilePath`
- **Type**: `string`
- **Description**: Filesystem path to the Better BibTeX `.bib` file representing a Zotero collection.

### 2. Update settings UI

Add a new text input under General Settings in `src/settings/settings.tsx`:

```tsx
<SettingItem
  name="Better BibTeX .bib File"
  description="Path to the Better BibTeX .bib file for a Zotero collection."
>
  <input
    type="text"
    placeholder="/path/to/collection.bib"
    defaultValue={settings.betterBibFilePath}
    onChange={(e) => updateSetting('betterBibFilePath', e.target.value)}
    spellCheck={false}
  />
</SettingItem>
```

### 3. Update default settings and types

- Add `betterBibFilePath: ''` to `DEFAULT_SETTINGS` in `src/main.ts`.
- Add `betterBibFilePath: string;` to the `ZoteroConnectorSettings` interface in `src/types.ts`.

### 4. Implement the new command

In `src/main.ts`, under `onload()`, register a new command:

- **ID**: `zdc-import-bbt-collection`
- **Name**: _Import Zotero collection (Better BibTeX .bib)_
- **Callback**:
  1. Read `settings.betterBibFilePath`; if empty or missing, show a Notice and abort.
  2. Read the `.bib` file contents; on error, show a Notice and abort.
  3. Use a regex to parse all citekeys: `/@[^{]+\{([^,]+),/g`.
  4. Remove duplicates and sort (optional).
  5. Determine the import format (similar to existing commands).
  6. Loop through each citekey, calling `this.runImport(formatName, citekey)`.
  7. Accumulate created paths and errors.
  8. After processing, open new notes (if any) and show a summary Notice.

Reuse existing helper methods `pickImportFormat`, `runImport`, and `openNotes`.

### 5. Documentation

Optionally, add or update a doc in `docs/` (e.g., `docs/BETTER_BIBTEX_COLLECTION_IMPORT.md`) describing:

- How to configure the Better BibTeX export in Zotero.
- How to set `Better BibTeX .bib File` in plugin settings.
- How to run the new command.

## Next Steps

1. Create the plan file (this document).
2. Update `src/types.ts`, `src/main.ts`, and `src/settings/settings.tsx`.
3. Implement the command logic and tests (manual).
4. Add documentation for end users.
5. Run `pre-commit` checks and verify functionality.