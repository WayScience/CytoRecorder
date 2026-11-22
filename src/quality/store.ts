import type { QualityLabel } from './types';

export const MAX_FIELD_LENGTH = 500;
const DB_VERSION = 1;
const STORE = 'quality_labels';
/** Defaults from the issue; a page can override via the `qc-labels` URL param. */
export const DEFAULT_QUALITY_CATEGORIES = ['Good', 'Out-of-focus', 'Debris'];

/** `\u241F` (unit separator) cannot appear in a path or a typed name, so this
 * stays unambiguous without escaping either half. */
export function qualityLabelId(imagePath: string, annotator: string): string {
  return `${imagePath}\u241F${annotator}`;
}

export function createQualityLabel(
  imagePath: string,
  project: string,
  annotator: string,
  qualityLabel: string,
  existing?: QualityLabel,
): QualityLabel {
  const timestamp = new Date().toISOString();
  return validateQualityLabel({
    id: qualityLabelId(imagePath, annotator.trim()),
    schemaVersion: 1,
    imagePath,
    project: project.trim(),
    annotator: annotator.trim(),
    qualityLabel,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

export function validateQualityLabel(value: unknown): QualityLabel {
  if (!value || typeof value !== 'object') throw Error('Invalid quality label record.');
  const n = value as QualityLabel;
  const validTime = (s: unknown): s is string =>
    typeof s === 'string' && Number.isFinite(Date.parse(s));
  if (n.schemaVersion !== 1) throw Error('Unsupported quality label schema version.');
  if (typeof n.id !== 'string' || !n.id) throw Error('Invalid quality label id.');
  if (typeof n.imagePath !== 'string' || !n.imagePath.trim()) throw Error('Invalid image path.');
  if (
    typeof n.annotator !== 'string' ||
    !n.annotator.trim() ||
    n.annotator.length > MAX_FIELD_LENGTH
  )
    throw Error(`Annotator name must contain 1–${MAX_FIELD_LENGTH} characters.`);
  if (typeof n.project !== 'string' || n.project.length > MAX_FIELD_LENGTH)
    throw Error(`Project must be at most ${MAX_FIELD_LENGTH} characters.`);
  if (
    typeof n.qualityLabel !== 'string' ||
    !n.qualityLabel.trim() ||
    n.qualityLabel.length > MAX_FIELD_LENGTH
  )
    throw Error('Invalid quality label.');
  if (n.id !== qualityLabelId(n.imagePath, n.annotator))
    throw Error('Quality label id does not match its image path and annotator.');
  if (
    !validTime(n.createdAt) ||
    !validTime(n.updatedAt) ||
    Date.parse(n.updatedAt) < Date.parse(n.createdAt)
  )
    throw Error('Invalid quality label timestamps.');
  return structuredClone(n);
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Columns match the issue verbatim: image path, project, annotator, quality label. */
export function exportQualityLabelsCsv(labels: QualityLabel[]): string {
  const header = [
    'image_path',
    'project',
    'annotator',
    'quality_label',
    'created_at',
    'updated_at',
  ];
  const rows = labels.map((l) =>
    [l.imagePath, l.project, l.annotator, l.qualityLabel, l.createdAt, l.updatedAt]
      .map(csvField)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Mirrors voice/notes-store.ts's IndexedDB conventions: transaction completion,
 * not individual request success, is the durable-write boundary. */
export class QualityLabelStore {
  private opening?: Promise<IDBDatabase>;
  constructor(private readonly name = 'cytorecorder-quality-labels') {}

  private open(): Promise<IDBDatabase> {
    return (this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(Error('Local quality-label storage is unavailable in this browser.'));
        return;
      }
      const request = indexedDB.open(this.name, DB_VERSION);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onblocked = () => {
        blocked = true;
        reject(Error('Close other CytoRecorder tabs and retry quality-label storage.'));
      };
      request.onerror = () =>
        reject(request.error ?? Error('Could not open local quality-label storage.'));
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          this.opening = undefined;
        };
        resolve(db);
      };
    }).catch((error: unknown) => {
      this.opening = undefined;
      throw error;
    }));
  }

  async list(): Promise<QualityLabel[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'),
        request = tx.objectStore(STORE).getAll();
      tx.oncomplete = () => {
        try {
          resolve(
            (request.result as unknown[])
              .map(validateQualityLabel)
              .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
          );
        } catch (error) {
          reject(error);
        }
      };
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? Error('Could not read local quality labels.'));
    });
  }

  async get(id: string): Promise<QualityLabel | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'),
        request = tx.objectStore(STORE).get(id);
      tx.oncomplete = () => {
        try {
          resolve(request.result ? validateQualityLabel(request.result) : undefined);
        } catch (error) {
          reject(error);
        }
      };
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? Error('Could not read local quality label.'));
    });
  }

  async put(value: QualityLabel): Promise<void> {
    const label = validateQualityLabel(value),
      db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(label);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? Error('Local save failed. Storage may be full or blocked.'));
    });
  }

  close(): void {
    const pending = this.opening;
    this.opening = undefined;
    void pending?.then((db) => db.close()).catch(() => {});
  }
}
