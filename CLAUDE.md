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

## Planned Improvements

### Autosync Status Icon

**Current Issue**: During autosync, loading modals like "Fetching data from Zotero" and "Extracting annotations" are suppressed to avoid UI clutter, but users have no visual feedback that imports are happening.

**Proposed Solution**: Add a subtle status icon in the status bar that shows autosync activity:

1. **Icon States**:
   - Hidden: No autosync activity
   - Spinning/animated: Import in progress
   - Success flash: Import completed successfully
   - Error state: Import failed (brief red indicator)

2. **Implementation**:
   - Add status bar item in `onload()` using `this.addStatusBarItem()`
   - Create `updateSyncStatus(state: 'idle' | 'syncing' | 'success' | 'error')` method
   - Call status updates in `detectAndImportNewCitations()`:
     - Set to 'syncing' at start
     - Set to 'success' when completed
     - Set to 'error' on failures
   - Use CSS animations for spinning effect
   - Auto-hide success/error states after 3 seconds

3. **Benefits**:
   - Non-intrusive visual feedback
   - Users know when autosync is working
   - Quick error indication without modal dialogs
   - Maintains clean UI during background operations

### Annotation-Specific Monitoring Roadmap

**Goal**: Monitor Zotero specifically for when annotations are added to existing citations, rather than monitoring all bibliography changes.

#### Phase 1: Research & Analysis (Completed)
- ✅ Analyzed Better BibTeX JSON-RPC API capabilities
- ✅ Identified key limitation: No real-time change notifications
- ✅ Best available method: `item.attachments` for detailed annotation data

#### Phase 2: Annotation Cache System
**Implementation**: Store annotation snapshots to detect changes

1. **Annotation Fingerprinting**:
   - Create annotation cache in settings: `annotationCache: Record<citekey, AnnotationSnapshot[]>`
   - Store annotation count, content hashes, and last-seen timestamps
   - Use `item.attachments` to get current annotation data

2. **Change Detection**:
   - Compare current annotations vs cached snapshots
   - Detect: new annotations, modified annotations, deleted annotations
   - Track annotation modification dates when available

#### Phase 3: Smart Polling Strategy
**Implementation**: Efficient monitoring without overwhelming Zotero

1. **Tiered Polling**:
   - **Active items** (recently viewed/modified): Poll every 2-5 minutes
   - **Recently imported items**: Poll every 10-15 minutes for first week
   - **Older items**: Poll every hour or on-demand only

2. **Batch Processing**:
   - Group multiple `item.attachments` calls efficiently
   - Use existing `ZQueue` system for rate limiting
   - Process in chunks to avoid overwhelming Better BibTeX

3. **User Activity Triggers**:
   - Poll immediately when Obsidian gains focus (user returned from Zotero)
   - Poll when specific commands are run
   - Optional: Manual "check for annotation updates" command

#### Phase 4: Annotation-Aware Import
**Implementation**: Smart re-import of items with new annotations

1. **Selective Re-import**:
   - Only re-import notes when annotations actually changed
   - Preserve existing note content, append/update annotation sections
   - Use template system to merge new annotations properly

2. **Annotation Diff Handling**:
   - Identify which specific annotations are new
   - Support incremental updates rather than full re-import
   - Track annotation-to-note mappings

#### Phase 5: Advanced Features
**Implementation**: Enhanced annotation workflow

1. **Annotation Notifications**:
   - Configurable notifications for new annotations
   - Show which citations got new annotations
   - Link directly to updated notes

2. **Annotation Analytics**:
   - Track annotation activity patterns
   - Show "recently annotated" items
   - Integration with Obsidian's recent files

3. **Bidirectional Sync** (Future):
   - Research if Obsidian note changes can trigger Zotero updates
   - Explore annotation round-trip workflows

#### Technical Challenges & Solutions

**Challenge**: No real-time Zotero change notifications
**Solution**: Intelligent polling with activity-based frequency adjustment

**Challenge**: Detecting annotation changes without modification dates
**Solution**: Content-based fingerprinting and snapshot comparison

**Challenge**: Avoiding excessive API calls to Better BibTeX
**Solution**: Batched requests, rate limiting, and tiered polling strategy

**Challenge**: Merging new annotations with existing notes
**Solution**: Enhanced template system with annotation diff support

#### Implementation Priority
1. **High Priority**: Annotation cache system and basic change detection
2. **Medium Priority**: Smart polling and selective re-import
3. **Low Priority**: Advanced notifications and analytics

This approach would provide much more targeted monitoring than .bib file watching, focusing specifically on the annotation changes that matter most to your workflow.