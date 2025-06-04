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