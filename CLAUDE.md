# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin that integrates with Zotero for citation management. It allows users to insert citations, import bibliographies, extract PDF annotations, and sync notes between Zotero and Obsidian. The plugin requires the Better BibTeX for Zotero extension.

## Development Commands

- `yarn dev` - Start development build with file watching
- `yarn build` - Production build
- `yarn check-types` - Run TypeScript type checking
- `yarn lint` - Run ESLint
- `yarn lint:fix` - Run ESLint with auto-fix
- `yarn prettier` - Format code with Prettier
- `yarn clean` - Run prettier and lint:fix together
- `yarn test` - Run Jest tests

## Architecture

### Core Plugin Structure
- `src/main.ts` - Main plugin entry point, extends Obsidian Plugin class
- `src/types.ts` - TypeScript type definitions for the entire plugin
- `src/settings/` - Settings UI components and configuration management
- `src/bbt/` - Better BibTeX integration layer

### Key Architectural Components

**Main Plugin (`src/main.ts`)**:
- Manages plugin lifecycle, commands, and settings
- Handles file watching for .bib auto-sync functionality
- Coordinates between UI, Zotero communication, and file operations

**Better BibTeX Integration (`src/bbt/`)**:
- `jsonRPC.ts` - HTTP communication with Zotero via Better BibTeX JSON-RPC API
- `cayw.ts` - "Cite As You Write" functionality for real-time citation insertion
- `export.ts` - Export citations and bibliographies to Markdown
- `exportNotes.ts` - Import and process Zotero notes
- `extractAnnotations.ts` - Extract PDF annotations from Zotero
- `bibSync.ts` - Background sync between .bib files and Obsidian note metadata
- `template.*.ts` - Template processing for customizable output formats

**Settings System (`src/settings/`)**:
- React-based settings UI using Preact compatibility layer
- `CiteFormatSettings.tsx` - Configure citation formats
- `ExportFormatSettings.tsx` - Configure export/import templates
- `AssetDownloader.tsx` - Manage PDF utility downloads

### Data Flow

1. **Citation Workflow**: User triggers citation command → CAYW queries Zotero via JSON-RPC → Returns formatted citation
2. **Import Workflow**: User selects items in Zotero → Plugin fetches via JSON-RPC → Processes through templates → Creates Obsidian notes
3. **Sync Workflow**: .bib file changes → File watcher triggers → Parses metadata → Updates frontmatter in existing notes

## Build System

- **esbuild** for fast TypeScript compilation and bundling
- **Target**: ES2018, CommonJS format for Obsidian compatibility
- **External dependencies**: Obsidian API, Node.js modules, CodeMirror packages
- **Development**: Watch mode with inline source maps
- **Production**: Minified output without source maps

## Technology Stack

- **TypeScript** with React/Preact for UI components
- **Node.js APIs** for file system operations and external process execution
- **Better BibTeX JSON-RPC** for Zotero communication
- **Nunjucks** templating engine for customizable output
- **Jest** for testing with Babel compilation

## Important Notes

- Plugin is desktop-only (no mobile support)
- Requires Zotero with Better BibTeX plugin
- Uses Preact as React compatibility layer (see tsconfig paths)
- File operations use Node.js fs module directly
- Communication with Zotero happens over localhost HTTP