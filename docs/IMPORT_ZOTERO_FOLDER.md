# Importing an Entire Zotero Folder into Obsidian

This guide explains how to import an entire Zotero folder via the Obsidian Zotero Integration plugin. The plugin is designed to handle one Zotero entry at a time, but you can import multiple entries by placing them in a folder and triggering a batch import.

## Overview

The plugin reads annotations exported from Zotero for individual entries and converts them into Obsidian notes. In its current design, each Zotero entry is processed one at a time. By following this guide, you can effectively import a full folder of Zotero entries into your vault.

## Prerequisites

- Optionally, export annotations or entry data from Zotero if you prefer manual export mode. Each entry should be saved as an individual JSON or Markdown file in a designated folder.
- Alternatively, point the plugin at your Zotero storage folder (e.g., `<Zotero Data Directory>/storage`) to import PDF attachments and extract annotations directly, without a separate export step.
- Obsidian and the Obsidian Zotero Integration plugin must be installed and configured correctly.

## Steps to Import an Entire Zotero Folder

1. **Prepare Your Zotero Folder**
   - If using manual export mode, export annotations or entry data from Zotero so that each entry is saved as an individual JSON or Markdown file.
   - If using direct storage mode, point to your Zotero storage folder (e.g., `<Zotero Data Directory>/storage`) instead.

2. **Configure the Plugin (Optional)**
   - Update the plugin’s settings to specify the path to your Zotero folder.
     - For manual exports, select the folder containing your JSON/Markdown files.
     - For direct PDF import, select your Zotero storage folder (e.g., `<Zotero Data Directory>/storage`).
   - Open Obsidian, navigate to the plugin’s settings, and verify the folder location.

3. **Trigger the Import Command**
   - Open Obsidian’s Command Palette (usually via `Cmd+P` or `Ctrl+P`).
   - Look for the command labeled “Import Entire Zotero Folder” (or a similar name, depending on your configuration).
   - Execute the command. This command is registered in the plugin (see `src/main.ts`) and initiates the batch import process.

4. **Batch Processing**
   - The plugin inspects the specified folder:
     - If it contains JSON or Markdown export files, each file is imported individually.
     - Otherwise, all Zotero items are imported directly via the Zotero RPC, extracting annotations from PDF attachments.
   - For every Zotero entry or PDF file, the plugin processes the annotation data and converts it into a Markdown note in your Obsidian vault.
   - Keep an eye on the Obsidian console or logs for any messages in case an error occurs during processing.

5. **Review Imported Notes**
   - After the import completes, check your vault for the newly created notes.
   - Verify that annotations, formatting, and metadata have been transferred correctly.
   - If issues surface, refer to the troubleshooting section below.

## Troubleshooting

**Missing Command**: Ensure your plugin is updated to the latest version and that the import command is correctly registered in `src/main.ts`.

**Incorrect Folder Path**: Double-check the path set in the plugin’s settings to confirm it points to the folder with your Zotero exports.

**File Format Errors**: Verify that the Zotero export files are in the correct format. If necessary, review the parsing logic in the plugin (for instance, in the module handling annotation imports).

## Codebase Reference

- The single-entry import functionality is implemented in `src/main.ts`.
- Batch import functionality iterates over folder contents using Node’s `fs` module.
- To extend or modify the import logic (e.g., adding support for recursive folder traversal), consider updating the relevant methods found in the codebase.

## Conclusion

Following these steps allows you to efficiently import an entire Zotero folder by converting each entry’s annotations into separate Obsidian notes. Feel free to adjust settings and code details to suit your workflow.