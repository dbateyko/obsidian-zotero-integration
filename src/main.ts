import Fuse from 'fuse.js';
import { EditableFileView, Events, Plugin, TFile, FuzzySuggestModal, Notice, App } from 'obsidian';
import { shellPath } from 'shell-path';
import { debounce } from 'obsidian';
import fs from 'fs';
import path from 'path';
import { parseBibToMetadataMap, diffMetadata, patchFrontmatterContent } from './bbt/bibSync';

import { DataExplorerView, viewType } from './DataExplorerView';
import { LoadingModal } from './bbt/LoadingModal';
import { getCAYW, isZoteroRunning } from './bbt/cayw';
import { exportToMarkdown, renderCiteTemplate } from './bbt/export';
import {
  filesFromNotes,
  insertNotesIntoCurrentDoc,
  noteExportPrompt,
} from './bbt/exportNotes';
import './bbt/template.helpers';
import {
  currentVersion,
  downloadAndExtract,
  internalVersion,
} from './settings/AssetDownloader';
import { ZoteroConnectorSettingsTab } from './settings/settings';
import {
  CitationFormat,
  CiteKeyExport,
  ExportFormat,
  ZoteroConnectorSettings,
} from './types';

const commandPrefix = 'obsidian-zotero-desktop-connector:';
const citationCommandIDPrefix = 'zdc-';
const exportCommandIDPrefix = 'zdc-exp-';
const DEFAULT_SETTINGS: ZoteroConnectorSettings = {
  database: 'Zotero',
  zoteroExportFolder: '',
  betterBibFilePath: '',
  autoSyncBibFile: true,
  bibWatchDebounce: 500,
  metadataMap: {},
  noteImportFolder: '',
  pdfExportImageDPI: 120,
  pdfExportImageFormat: 'jpg',
  pdfExportImageQuality: 90,
  citeFormats: [],
  exportFormats: [],
  citeSuggestTemplate: '[[{{citekey}}]]',
  openNoteAfterImport: false,
  whichNotesToOpenAfterImport: 'first-imported-note',
  importedItems: {},
  autorunOnStartup: false,
};

async function fixPath() {
  if (process.platform === 'win32') {
    return;
  }

  try {
    const path = await shellPath();

    process.env.PATH =
      path ||
      [
        './node_modules/.bin',
        '/.nodebrew/current/bin',
        '/usr/local/bin',
        process.env.PATH,
      ].join(':');
  } catch (e) {
    console.error(e);
  }
}

export default class ZoteroConnector extends Plugin {
  settings: ZoteroConnectorSettings;
  emitter: Events;
  fuse: Fuse<CiteKeyExport>;

  async onload() {
    await this.loadSettings();
    this.emitter = new Events();

    this.updatePDFUtility();
    this.addSettingTab(new ZoteroConnectorSettingsTab(this.app, this));
    this.registerView(viewType, (leaf) => new DataExplorerView(this, leaf));

    this.settings.citeFormats.forEach((f) => {
      this.addFormatCommand(f);
    });

    this.settings.exportFormats.forEach((f) => {
      this.addExportCommand(f);
    });

    this.addCommand({
      id: 'zdc-insert-notes',
      name: 'Insert notes into current document',
      editorCallback: (editor) => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        noteExportPrompt(
          database,
          this.app.workspace.getActiveFile()?.parent.path
        ).then((notes) => {
          if (notes) {
            insertNotesIntoCurrentDoc(editor, notes);
          }
        });
      },
    });

    this.addCommand({
      id: 'zdc-import-notes',
      name: 'Import notes',
      callback: () => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        noteExportPrompt(database, this.settings.noteImportFolder)
          .then((notes) => {
            if (notes) {
              return filesFromNotes(this.settings.noteImportFolder, notes);
            }
            return [] as string[];
          })
          .then((notes) => this.openNotes(notes));
      },
    });

    this.addCommand({
      id: 'zdc-import-zotero-folder',
      name: 'Import entire Zotero folder',
      callback: async () => {
        const folder = this.settings.zoteroExportFolder;
        if (!folder) {
          new Notice('Error: Zotero export folder is not set. Please configure it in plugin settings.');
          return;
        }
        const formats = this.settings.exportFormats;
        if (!formats.length) {
          new Notice('Error: No import formats configured. Please add an import format in plugin settings.');
          return;
        }
        let formatName: string;
        if (formats.length === 1) {
          formatName = formats[0].name;
        } else {
          const picked = await this.pickImportFormat(formats.map((f) => f.name));
          if (!picked) {
            return;
          }
          formatName = picked;
        }
        let createdPaths: string[] = [];
        try {
          const files = fs
            .readdirSync(folder)
            .filter((f) => f.endsWith('.json') || f.endsWith('.md'));
          if (files.length > 0) {
            for (const file of files) {
              const citekey = path.parse(file).name;
              try {
                const paths = await this.runImport(formatName, citekey);
                createdPaths.push(...paths);
              } catch (e) {
                console.error(e);
                new Notice(`Error importing ${citekey}`, 7000);
              }
            }
          } else {
            try {
              createdPaths = await this.runBatchImport(formatName);
            } catch (e) {
              console.error(e);
              new Notice(`Error importing Zotero library`, 7000);
              return;
            }
          }
        } catch (e) {
          new Notice(`Error reading Zotero folder: ${(e as Error).message}`);
          return;
        }
        if (createdPaths.length) {
          this.openNotes(createdPaths);
          new Notice(`Imported ${createdPaths.length} items`);
        } else {
          new Notice('No items were imported');
        }
      },
    });

    this.addCommand({
      id: 'zdc-import-bbt-collection',
      name: 'Import Zotero collection (Better BibTeX .bib)',
      callback: async () => {
        await this.importBbtCollection();
      },
    });

    this.addCommand({
      id: 'show-zotero-debug-view',
      name: 'Data explorer',
      callback: () => {
        this.activateDataExplorer();
      },
    });

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          this.emitter.trigger('fileUpdated', file);
        }
      })
    );

    app.workspace.trigger('parse-style-settings');

    fixPath();

    if (this.settings.autorunOnStartup) {
      setTimeout(async () => {
        const database = { database: this.settings.database, port: this.settings.port };
        if (await isZoteroRunning(database, true)) {
          try {
            await this.importBbtCollection(true);
            new Notice('Attempting to sync metadata from .bib file on startup...', 3000);
            await this.syncMetadataFromBib();
            new Notice('Startup metadata sync complete.', 3000);
          } catch (e) {
            console.error('Error syncing metadata from .bib on startup:', e);
            new Notice(`Error syncing metadata on startup: ${(e as Error).message}`, 7000);
          }
        } else {
          console.warn('Zotero is not running; skipping autorun import.');
        }
      }, 5000);
    }
  }

  onunload() {
    this.settings.citeFormats.forEach((f) => {
      this.removeFormatCommand(f);
    });

    this.settings.exportFormats.forEach((f) => {
      this.removeExportCommand(f);
    });

    this.app.workspace.detachLeavesOfType(viewType);
  }

  addFormatCommand(format: CitationFormat) {
    this.addCommand({
      id: `${citationCommandIDPrefix}${format.name}`,
      name: format.name,
      editorCallback: (editor) => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        if (format.format === 'template' && format.template.trim()) {
          renderCiteTemplate({
            database,
            format,
          }).then((res) => {
            if (typeof res === 'string') {
              editor.replaceSelection(res);
            }
          });
        } else {
          getCAYW(format, database).then((res) => {
            if (typeof res === 'string') {
              editor.replaceSelection(res);
            }
          });
        }
      },
    });
  }

  removeFormatCommand(format: CitationFormat) {
    (this.app as any).commands.removeCommand(
      `${commandPrefix}${citationCommandIDPrefix}${format.name}`
    );
  }

  addExportCommand(format: ExportFormat) {
    this.addCommand({
      id: `${exportCommandIDPrefix}${format.name}`,
      name: format.name,
      callback: async () => {
        const database = {
          database: this.settings.database,
          port: this.settings.port,
        };
        this.openNotes(
          await exportToMarkdown({
            settings: this.settings,
            database,
            exportFormat: format,
          })
        );
      },
    });
  }

  removeExportCommand(format: ExportFormat) {
    (this.app as any).commands.removeCommand(
      `${commandPrefix}${exportCommandIDPrefix}${format.name}`
    );
  }

  private async pickImportFormat(formatNames: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      class FormatModal extends FuzzySuggestModal<string> {
        getItems() {
          return formatNames;
        }
        getItemText(item: string) {
          return item;
        }
        onChooseItem(item: string) {
          resolve(item);
          this.close();
        }
      }
      new FormatModal(this.app).open();
    });
  }

  async runImport(
    name: string,
    citekey: string,
    library: number = 1,
    skipIfNoAnnotations: boolean = false,
    silent: boolean = false
  ): Promise<string[]> {
    const format = this.settings.exportFormats.find((f) => f.name === name);

    if (!format) {
      throw new Error(`Error: Import format "${name}" not found`);
    }

    const database = {
      database: this.settings.database,
      port: this.settings.port,
    };

    if (citekey.startsWith('@')) citekey = citekey.substring(1);

    const createdOrUpdatedMarkdownFiles = await exportToMarkdown(
      {
        settings: this.settings,
        database,
        exportFormat: format,
        skipIfNoAnnotations,
        silent,
      },
      [{ key: citekey, library }]
    );
    return createdOrUpdatedMarkdownFiles;
  }

  async runBatchImport(name: string): Promise<string[]> {
    const format = this.settings.exportFormats.find((f) => f.name === name);

    if (!format) {
      throw new Error(`Error: Import format "${name}" not found`);
    }

    const database = {
      database: this.settings.database,
      port: this.settings.port,
    };

    
    const createdOrUpdatedMarkdownFiles = await exportToMarkdown(
      {
        settings: this.settings,
        database,
        exportFormat: format,
      }
    );
    return createdOrUpdatedMarkdownFiles;
  }

  async importBbtCollection(silent: boolean = false): Promise<string[]> {
    const bibPath = this.settings.betterBibFilePath;
    if (!bibPath) {
      new Notice(
        'Error: Better BibTeX .bib file path is not set. Please configure it in plugin settings.'
      );
      return [];
    }
    let content: string;
    try {
      content = fs.readFileSync(bibPath, 'utf-8');
    } catch (e) {
      console.error(e);
      new Notice(`Error reading .bib file: ${(e as Error).message}`, 7000);
      return [];
    }
    const citekeySet = new Set<string>();
    const bibRegex = /@[^{]+\{([^,}]+)[,}]/g;
    let match: RegExpExecArray | null;
    while ((match = bibRegex.exec(content))) {
      citekeySet.add(match[1].trim());
    }
    if (!citekeySet.size) {
      new Notice('No citation keys found in .bib file', 7000);
      return [];
    }
    const imported = this.settings.importedItems;
    const allKeys = Array.from(citekeySet).sort();
    const newKeys = allKeys.filter((k) => !imported[k]);
    if (!newKeys.length) {
      new Notice('No new citation keys to import');
      return [];
    }
    const formats = this.settings.exportFormats;
    if (!formats.length) {
      new Notice(
        'Error: No import formats configured. Please add an import format in plugin settings.'
      );
      return [];
    }
    let formatName: string;
    if (formats.length === 1) {
      formatName = formats[0].name;
    } else {
      const picked = await this.pickImportFormat(formats.map((f) => f.name));
      if (!picked) {
        return [];
      }
      formatName = picked;
    }
    const createdPaths: string[] = [];
    for (const citekey of newKeys) {
      try {
        const paths = await this.runImport(formatName, citekey, 1, true, silent);
        createdPaths.push(...paths);
        this.settings.importedItems[citekey] = paths[0] || '';
      } catch (e) {
        console.error(`Error importing ${citekey}`, e);
        new Notice(`Error importing ${citekey}`, 5000);
      }
    }
    await this.saveSettings();
    if (createdPaths.length) {
      this.openNotes(createdPaths);
      new Notice(
        `Imported ${createdPaths.length} new items from BBT collection`
      );
    } else {
      new Notice('No new items were imported from BBT collection');
    }
    return createdPaths;
  }

  async openNotes(createdOrUpdatedMarkdownFilesPaths: string[]) {
    const pathOfNotesToOpen: string[] = [];
    if (this.settings.openNoteAfterImport) {
      // Depending on the choice, retreive the paths of the first, the last or all imported notes
      switch (this.settings.whichNotesToOpenAfterImport) {
        case 'first-imported-note': {
          pathOfNotesToOpen.push(createdOrUpdatedMarkdownFilesPaths[0]);
          break;
        }
        case 'last-imported-note': {
          pathOfNotesToOpen.push(
            createdOrUpdatedMarkdownFilesPaths[
              createdOrUpdatedMarkdownFilesPaths.length - 1
            ]
          );
          break;
        }
        case 'all-imported-notes': {
          pathOfNotesToOpen.push(...createdOrUpdatedMarkdownFilesPaths);
          break;
        }
      }
    }

    // Force a 1s delay after importing the files to make sure that notes are created before attempting to open them.
    // A better solution could surely be found to refresh the vault, but I am not sure how to proceed!
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const path of pathOfNotesToOpen) {
      const note = this.app.vault.getAbstractFileByPath(path);
      const open = leaves.find(
        (leaf) => (leaf.view as EditableFileView).file === note
      );
      if (open) {
        app.workspace.revealLeaf(open);
      } else if (note instanceof TFile) {
        await this.app.workspace.getLeaf(true).openFile(note);
      }
    }
  }

  private initializeBibFileWatcher() {
    if (this.bibFileWatcher) {
      this.bibFileWatcher.close();
      this.bibFileWatcher = undefined;
    }
    if (!this.settings.autoSyncBibFile) {
      return;
    }
    const bibPath = this.settings.betterBibFilePath;
    if (!bibPath) {
      new Notice('Better BibTeX .bib file path not set; cannot auto-sync');
      return;
    }
    const handler = debounce(() => {
      this.handleBibFileChange();
    }, this.settings.bibWatchDebounce || 500);
    try {
      this.bibFileWatcher = fs.watch(bibPath, { persistent: true }, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          handler();
          if (eventType === 'rename') {
            setTimeout(() => this.initializeBibFileWatcher(), 1000);
          }
        }
      });
    } catch (e) {
      const dir = path.dirname(bibPath);
      const base = path.basename(bibPath);
      this.bibFileWatcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
        if (filename === base && (eventType === 'change' || eventType === 'rename')) {
          handler();
          if (eventType === 'rename') {
            setTimeout(() => this.initializeBibFileWatcher(), 1000);
          }
        }
      });
    }
    this.bibFileWatcher.on('error', (err) => {
      console.warn('Error watching .bib file for metadata sync', err);
    });
  }

  private async handleBibFileChange() {
    new Notice('Detected .bib file change; syncing metadata...', 3000);
    try {
      await this.syncMetadataFromBib();
      new Notice('Metadata sync complete', 3000);
    } catch (e) {
      console.error('Error syncing metadata from .bib:', e);
      new Notice(`Error syncing metadata: ${(e as Error).message}`, 5000);
    }
  }

  private async syncMetadataFromBib() {
    const bibPath = this.settings.betterBibFilePath;
    let content: string;
    try {
      content = fs.readFileSync(bibPath, 'utf-8');
    } catch (e) {
      console.error(e);
      new Notice(`Error reading .bib file: ${(e as Error).message}`, 7000);
      return;
    }
    const newMap = parseBibToMetadataMap(content);
    const oldMap = this.settings.metadataMap || {};
    const diffs = diffMetadata(oldMap, newMap);
    for (const citekey of Object.keys(diffs)) {
      const fields = diffs[citekey];
      const notePath = this.settings.importedItems[citekey];
      if (notePath) {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (file && file instanceof TFile) {
          try {
            const fileContent = await this.app.vault.read(file);
            const updated = patchFrontmatterContent(fileContent, fields);
            await this.app.vault.modify(file, updated);
          } catch (err) {
            console.error(`Error patching metadata for ${citekey}`, err);
          }
        }
      }
    }
    this.settings.metadataMap = newMap;
    await this.saveSettings();
  }

  async loadSettings() {
    const loadedSettings = await this.loadData();

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
    };
  }

  async saveSettings() {
    this.emitter.trigger('settingsUpdated');
    await this.saveData(this.settings);
  }

  deactivateDataExplorer() {
    this.app.workspace.detachLeavesOfType(viewType);
  }

  async activateDataExplorer() {
    this.deactivateDataExplorer();
    const leaf = this.app.workspace.createLeafBySplit(
      this.app.workspace.activeLeaf,
      'vertical'
    );

    await leaf.setViewState({
      type: viewType,
    });
  }

  async updatePDFUtility() {
    const { exeOverridePath, _exeInternalVersion, exeVersion } = this.settings;
    if (exeOverridePath || !exeVersion) return;

    if (
      exeVersion !== currentVersion ||
      !_exeInternalVersion ||
      _exeInternalVersion !== internalVersion
    ) {
      const modal = new LoadingModal(
        app,
        'Updating Obsidian Zotero Integration PDF Utility...'
      );
      modal.open();

      try {
        const success = await downloadAndExtract();

        if (success) {
          this.settings.exeVersion = currentVersion;
          this.settings._exeInternalVersion = internalVersion;
          this.saveSettings();
        }
      } catch {
        //
      }

      modal.close();
    }
  }
}
