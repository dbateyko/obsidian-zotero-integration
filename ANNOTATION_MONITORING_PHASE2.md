# Phase 2: Annotation Cache System Implementation

This document outlines the step-by-step implementation for Phase 2 of the annotation monitoring system.

## Overview

Build an annotation cache system that stores snapshots of annotation data for each citation and detects changes by comparison.

## Step 1: Extend Types and Settings

### 1.1 Add New Types (src/types.ts)

```typescript
export interface AnnotationSnapshot {
  id: string;
  type: string;
  content: string;
  contentHash: string;
  dateModified: string;
  pageLabel?: string;
  color?: string;
  imagePath?: string;
}

export interface AnnotationCacheEntry {
  citekey: string;
  lastChecked: number;
  annotationCount: number;
  annotations: AnnotationSnapshot[];
  contentHash: string; // Hash of all annotations combined
}

export interface AnnotationMonitoringSettings {
  enabled: boolean;
  checkIntervalMinutes: number;
  maxItemsPerBatch: number;
  enableNotifications: boolean;
}
```

### 1.2 Extend ZoteroConnectorSettings (src/types.ts)

```typescript
export interface ZoteroConnectorSettings {
  // ... existing properties ...
  
  // New annotation monitoring properties
  annotationCache: Record<string, AnnotationCacheEntry>;
  annotationMonitoring: AnnotationMonitoringSettings;
  lastAnnotationCheck: number;
}
```

### 1.3 Update DEFAULT_SETTINGS (src/main.ts)

```typescript
const DEFAULT_SETTINGS: ZoteroConnectorSettings = {
  // ... existing settings ...
  
  annotationCache: {},
  annotationMonitoring: {
    enabled: false, // Start disabled until user opts in
    checkIntervalMinutes: 10,
    maxItemsPerBatch: 20,
    enableNotifications: true,
  },
  lastAnnotationCheck: 0,
};
```

## Step 2: Create Annotation Cache Manager

### 2.1 Create src/bbt/annotationCache.ts

```typescript
import { createHash } from 'crypto';
import { AnnotationSnapshot, AnnotationCacheEntry, DatabaseWithPort } from '../types';
import { getAttachmentsFromCiteKey } from './jsonRPC';
import { CiteKey } from './cayw';

export class AnnotationCacheManager {
  
  /**
   * Generate a content hash for an annotation
   */
  private static hashAnnotation(annotation: any): string {
    const content = JSON.stringify({
      id: annotation.key || annotation.id,
      type: annotation.type,
      content: annotation.annotationText || annotation.comment || '',
      pageLabel: annotation.pageLabel,
      color: annotation.color,
    });
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Generate a combined hash for all annotations
   */
  private static hashAllAnnotations(annotations: AnnotationSnapshot[]): string {
    const combined = annotations
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(a => a.contentHash)
      .join('|');
    return createHash('md5').update(combined).digest('hex');
  }

  /**
   * Convert raw attachment data to annotation snapshots
   */
  static createAnnotationSnapshots(attachmentData: any[]): AnnotationSnapshot[] {
    const snapshots: AnnotationSnapshot[] = [];
    
    for (const attachment of attachmentData || []) {
      if (attachment.annotations) {
        for (const annotation of attachment.annotations) {
          const snapshot: AnnotationSnapshot = {
            id: annotation.key || annotation.id || `${Date.now()}-${Math.random()}`,
            type: annotation.type || 'highlight',
            content: annotation.annotationText || annotation.comment || '',
            contentHash: this.hashAnnotation(annotation),
            dateModified: annotation.dateModified || new Date().toISOString(),
            pageLabel: annotation.pageLabel,
            color: annotation.color,
            imagePath: annotation.imagePath,
          };
          snapshots.push(snapshot);
        }
      }
    }
    
    return snapshots;
  }

  /**
   * Create a cache entry for a citation
   */
  static createCacheEntry(
    citekey: string, 
    attachmentData: any[]
  ): AnnotationCacheEntry {
    const annotations = this.createAnnotationSnapshots(attachmentData);
    
    return {
      citekey,
      lastChecked: Date.now(),
      annotationCount: annotations.length,
      annotations,
      contentHash: this.hashAllAnnotations(annotations),
    };
  }

  /**
   * Compare two cache entries to detect changes
   */
  static detectChanges(
    oldEntry: AnnotationCacheEntry | undefined,
    newEntry: AnnotationCacheEntry
  ): {
    hasChanges: boolean;
    newAnnotations: AnnotationSnapshot[];
    modifiedAnnotations: AnnotationSnapshot[];
    deletedAnnotations: AnnotationSnapshot[];
  } {
    if (!oldEntry) {
      return {
        hasChanges: newEntry.annotations.length > 0,
        newAnnotations: newEntry.annotations,
        modifiedAnnotations: [],
        deletedAnnotations: [],
      };
    }

    // Quick check: if hashes match, no changes
    if (oldEntry.contentHash === newEntry.contentHash) {
      return {
        hasChanges: false,
        newAnnotations: [],
        modifiedAnnotations: [],
        deletedAnnotations: [],
      };
    }

    const oldAnnotationsMap = new Map(
      oldEntry.annotations.map(a => [a.id, a])
    );
    const newAnnotationsMap = new Map(
      newEntry.annotations.map(a => [a.id, a])
    );

    const newAnnotations: AnnotationSnapshot[] = [];
    const modifiedAnnotations: AnnotationSnapshot[] = [];
    const deletedAnnotations: AnnotationSnapshot[] = [];

    // Find new and modified annotations
    for (const newAnnotation of newEntry.annotations) {
      const oldAnnotation = oldAnnotationsMap.get(newAnnotation.id);
      
      if (!oldAnnotation) {
        newAnnotations.push(newAnnotation);
      } else if (oldAnnotation.contentHash !== newAnnotation.contentHash) {
        modifiedAnnotations.push(newAnnotation);
      }
    }

    // Find deleted annotations
    for (const oldAnnotation of oldEntry.annotations) {
      if (!newAnnotationsMap.has(oldAnnotation.id)) {
        deletedAnnotations.push(oldAnnotation);
      }
    }

    return {
      hasChanges: newAnnotations.length > 0 || modifiedAnnotations.length > 0 || deletedAnnotations.length > 0,
      newAnnotations,
      modifiedAnnotations,
      deletedAnnotations,
    };
  }

  /**
   * Get current annotation data for a citation and update cache
   */
  static async updateCacheEntry(
    citekey: string,
    database: DatabaseWithPort,
    currentCache: Record<string, AnnotationCacheEntry>,
    silent: boolean = true
  ): Promise<{
    entry: AnnotationCacheEntry;
    changes: ReturnType<typeof AnnotationCacheManager.detectChanges>;
  } | null> {
    try {
      const citeKeyObj: CiteKey = { key: citekey, library: 1 }; // TODO: Get proper library ID
      const attachmentData = await getAttachmentsFromCiteKey(citeKeyObj, database, silent);
      
      if (!attachmentData) {
        console.warn(`[Annotation Cache] No attachment data for ${citekey}`);
        return null;
      }

      const newEntry = this.createCacheEntry(citekey, attachmentData);
      const oldEntry = currentCache[citekey];
      const changes = this.detectChanges(oldEntry, newEntry);

      return { entry: newEntry, changes };
    } catch (error) {
      console.error(`[Annotation Cache] Error updating cache for ${citekey}:`, error);
      return null;
    }
  }
}
```

## Step 3: Add Annotation Monitoring to Main Plugin

### 3.1 Add Properties to ZoteroConnector Class (src/main.ts)

```typescript
export default class ZoteroConnector extends Plugin {
  // ... existing properties ...
  
  annotationMonitorInterval: NodeJS.Timeout | undefined;
  isMonitoringAnnotations: boolean = false;
```

### 3.2 Add Annotation Monitoring Methods (src/main.ts)

```typescript
  /**
   * Initialize annotation monitoring
   */
  private initializeAnnotationMonitoring() {
    if (!this.settings.annotationMonitoring.enabled) {
      return;
    }

    this.startAnnotationMonitoring();
  }

  /**
   * Start annotation monitoring with configured interval
   */
  private startAnnotationMonitoring() {
    if (this.annotationMonitorInterval) {
      clearInterval(this.annotationMonitorInterval);
    }

    const intervalMs = this.settings.annotationMonitoring.checkIntervalMinutes * 60 * 1000;
    
    this.annotationMonitorInterval = setInterval(() => {
      this.checkForAnnotationChanges();
    }, intervalMs);

    console.log(`[Annotation Monitor] Started with ${this.settings.annotationMonitoring.checkIntervalMinutes}min interval`);
  }

  /**
   * Stop annotation monitoring
   */
  private stopAnnotationMonitoring() {
    if (this.annotationMonitorInterval) {
      clearInterval(this.annotationMonitorInterval);
      this.annotationMonitorInterval = undefined;
    }
    console.log('[Annotation Monitor] Stopped');
  }

  /**
   * Check for annotation changes on imported items
   */
  private async checkForAnnotationChanges() {
    if (this.isMonitoringAnnotations) {
      console.log('[Annotation Monitor] Check already in progress, skipping...');
      return;
    }

    this.isMonitoringAnnotations = true;
    console.log('[Annotation Monitor] Starting annotation check...');

    try {
      const database = { database: this.settings.database, port: this.settings.port };
      const importedCitekeys = Object.keys(this.settings.importedItems);
      const maxBatch = this.settings.annotationMonitoring.maxItemsPerBatch;

      // Process in batches to avoid overwhelming Zotero
      for (let i = 0; i < importedCitekeys.length; i += maxBatch) {
        const batch = importedCitekeys.slice(i, i + maxBatch);
        await this.processBatchAnnotationCheck(batch, database);
        
        // Brief pause between batches
        if (i + maxBatch < importedCitekeys.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      this.settings.lastAnnotationCheck = Date.now();
      await this.saveSettings();

    } catch (error) {
      console.error('[Annotation Monitor] Error during annotation check:', error);
    } finally {
      this.isMonitoringAnnotations = false;
      console.log('[Annotation Monitor] Check completed');
    }
  }

  /**
   * Process a batch of citations for annotation changes
   */
  private async processBatchAnnotationCheck(citekeys: string[], database: DatabaseWithPort) {
    for (const citekey of citekeys) {
      try {
        const result = await AnnotationCacheManager.updateCacheEntry(
          citekey,
          database,
          this.settings.annotationCache,
          true // silent
        );

        if (result && result.changes.hasChanges) {
          console.log(`[Annotation Monitor] Changes detected for ${citekey}:`, {
            new: result.changes.newAnnotations.length,
            modified: result.changes.modifiedAnnotations.length,
            deleted: result.changes.deletedAnnotations.length,
          });

          // Update cache
          this.settings.annotationCache[citekey] = result.entry;

          // Handle the changes
          await this.handleAnnotationChanges(citekey, result.changes);
        } else if (result) {
          // Update cache even if no changes (updates lastChecked)
          this.settings.annotationCache[citekey] = result.entry;
        }

      } catch (error) {
        console.error(`[Annotation Monitor] Error checking ${citekey}:`, error);
      }
    }
  }

  /**
   * Handle detected annotation changes
   */
  private async handleAnnotationChanges(
    citekey: string, 
    changes: ReturnType<typeof AnnotationCacheManager.detectChanges>
  ) {
    const { newAnnotations, modifiedAnnotations, deletedAnnotations } = changes;

    if (this.settings.annotationMonitoring.enableNotifications) {
      let message = `${citekey}: `;
      const parts = [];
      
      if (newAnnotations.length > 0) {
        parts.push(`${newAnnotations.length} new annotation${newAnnotations.length > 1 ? 's' : ''}`);
      }
      if (modifiedAnnotations.length > 0) {
        parts.push(`${modifiedAnnotations.length} modified`);
      }
      if (deletedAnnotations.length > 0) {
        parts.push(`${deletedAnnotations.length} deleted`);
      }

      new Notice(message + parts.join(', '), 5000);
    }

    // TODO: In Phase 4, trigger selective re-import here
    console.log(`[Annotation Monitor] Would re-import ${citekey} due to annotation changes`);
  }
```

### 3.3 Update Plugin Lifecycle Methods (src/main.ts)

```typescript
  async onload() {
    // ... existing onload code ...

    // Initialize annotation monitoring after other setup
    this.initializeAnnotationMonitoring();
  }

  onunload() {
    // ... existing onunload code ...

    // Stop annotation monitoring
    this.stopAnnotationMonitoring();
  }

  async saveSettings() {
    this.emitter.trigger('settingsUpdated');
    await this.saveData(this.settings);
    
    // Reinitialize file watcher when settings change (but not during auto-import)
    if (!this.isUpdatingFromFileWatcher) {
      this.initializeBibFileWatcher();
      
      // Restart annotation monitoring if settings changed
      if (this.settings.annotationMonitoring.enabled) {
        this.startAnnotationMonitoring();
      } else {
        this.stopAnnotationMonitoring();
      }
    }
  }
```

## Step 4: Add Settings UI

### 4.1 Add to Settings Component (src/settings/settings.tsx)

Add a new section for annotation monitoring settings:

```typescript
// Add to SettingsComponent
const [annotationMonitoring, setAnnotationMonitoring] = React.useState(
  settings.annotationMonitoring
);

// Add JSX for annotation monitoring settings
<SettingItem
  name="Annotation Monitoring"
  description="Monitor existing citations for new annotations"
>
  <label>
    <input
      type="checkbox"
      checked={annotationMonitoring.enabled}
      onChange={(e) => {
        const updated = { ...annotationMonitoring, enabled: e.target.checked };
        setAnnotationMonitoring(updated);
        updateSetting('annotationMonitoring', updated);
      }}
    />
    Enable annotation monitoring
  </label>
  
  {annotationMonitoring.enabled && (
    <div style={{ marginTop: '10px' }}>
      <label>
        Check interval (minutes):
        <input
          type="number"
          min="1"
          max="60"
          value={annotationMonitoring.checkIntervalMinutes}
          onChange={(e) => {
            const updated = { 
              ...annotationMonitoring, 
              checkIntervalMinutes: parseInt(e.target.value) || 10 
            };
            setAnnotationMonitoring(updated);
            updateSetting('annotationMonitoring', updated);
          }}
        />
      </label>
      
      <label style={{ marginTop: '5px', display: 'block' }}>
        <input
          type="checkbox"
          checked={annotationMonitoring.enableNotifications}
          onChange={(e) => {
            const updated = { 
              ...annotationMonitoring, 
              enableNotifications: e.target.checked 
            };
            setAnnotationMonitoring(updated);
            updateSetting('annotationMonitoring', updated);
          }}
        />
        Show notifications for new annotations
      </label>
    </div>
  )}
</SettingItem>
```

## Step 5: Add Manual Commands

### 5.1 Add Commands to Plugin (src/main.ts)

```typescript
// Add to onload() method after existing commands

this.addCommand({
  id: 'zdc-check-annotation-changes',
  name: 'Check for annotation changes',
  callback: async () => {
    if (this.isMonitoringAnnotations) {
      new Notice('Annotation check already in progress');
      return;
    }
    
    new Notice('Checking for annotation changes...');
    await this.checkForAnnotationChanges();
    new Notice('Annotation check completed');
  },
});

this.addCommand({
  id: 'zdc-clear-annotation-cache',
  name: 'Clear annotation cache',
  callback: async () => {
    this.settings.annotationCache = {};
    await this.saveSettings();
    new Notice('Annotation cache cleared');
  },
});

this.addCommand({
  id: 'zdc-toggle-annotation-monitoring',
  name: 'Toggle annotation monitoring',
  callback: async () => {
    this.settings.annotationMonitoring.enabled = !this.settings.annotationMonitoring.enabled;
    await this.saveSettings();
    
    const status = this.settings.annotationMonitoring.enabled ? 'enabled' : 'disabled';
    new Notice(`Annotation monitoring ${status}`);
  },
});
```

## Step 6: Import Required Modules

### 6.1 Add Imports (src/main.ts)

```typescript
import { AnnotationCacheManager } from './bbt/annotationCache';
```

## Testing Plan

1. **Enable annotation monitoring** in settings
2. **Import a few citations** with existing annotations
3. **Add new annotations in Zotero** to one of the imported items
4. **Wait for check interval** or run manual "Check for annotation changes" command
5. **Verify console logs** show detected changes
6. **Check notifications** appear when enabled

## Success Criteria

- ✅ Settings UI allows enabling/configuring annotation monitoring
- ✅ System creates annotation cache entries for imported items
- ✅ Periodic checks detect when annotations are added/modified/deleted
- ✅ Console logs show detailed change information
- ✅ Notifications appear for annotation changes (when enabled)
- ✅ Manual commands work for testing and debugging

## Next Phase

Phase 3 will implement smart polling strategies and Phase 4 will add selective re-import of changed annotations.