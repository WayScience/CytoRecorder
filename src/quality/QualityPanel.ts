import './quality.css';
import { download } from '../exports';
import {
  createQualityLabel,
  DEFAULT_QUALITY_CATEGORIES,
  exportQualityLabelsCsv,
  qualityLabelId,
  QualityLabelStore,
} from './store';
import type { QualityLabel } from './types';

const ANNOTATOR_KEY = 'cytorecorder-qc-annotator';
const PROJECT_KEY = 'cytorecorder-qc-project';

/** Whole-image QC labeling, not per-object: addresses "Add whole-image quality
 * annotation workflow". Default categories Good / Out-of-focus / Debris, one
 * label per (image, annotator) so independent annotators never clobber each
 * other, and resumable — reopening the same image under the same annotator
 * name shows and can overwrite only that annotator's own prior label. */
export class QualityPanel {
  private readonly store = new QualityLabelStore();
  private readonly annotatorInput: HTMLInputElement;
  private readonly projectInput: HTMLInputElement;
  private readonly pathEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly labelsEl: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private image?: { path: string; project: string };
  private current?: QualityLabel;
  private readonly categories: string[];

  constructor(
    private readonly host: HTMLElement,
    options: { categories?: string[] } = {},
  ) {
    this.categories = options.categories?.length ? options.categories : DEFAULT_QUALITY_CATEGORIES;
    host.className = 'quality-panel';
    host.innerHTML = `
      <h3>Whole-image quality</h3>
      <p class="hint">Label this whole image, not an individual object. Stored only in this browser, one label per annotator per image; reopening the same image under the same annotator name resumes it.</p>
      <div class="quality-field"><label for="qc-project">Project</label><input id="qc-project" type="text" maxlength="500" placeholder="e.g. Bandicoot"></div>
      <div class="quality-field"><label for="qc-annotator">Annotator</label><input id="qc-annotator" type="text" maxlength="500" placeholder="Your name"></div>
      <p id="qc-path" class="hint"></p>
      <div id="qc-labels" class="quality-labels"></div>
      <p id="qc-status" class="hint" role="status" aria-live="polite"></p>
      <div class="quality-export-row"><span id="qc-count" class="hint"></span><button id="qc-export" type="button" class="secondary">Export quality labels (CSV)</button></div>
    `;
    this.annotatorInput = host.querySelector('#qc-annotator')!;
    this.projectInput = host.querySelector('#qc-project')!;
    this.pathEl = host.querySelector('#qc-path')!;
    this.statusEl = host.querySelector('#qc-status')!;
    this.countEl = host.querySelector('#qc-count')!;
    this.labelsEl = host.querySelector('#qc-labels')!;
    this.annotatorInput.value = localStorage.getItem(ANNOTATOR_KEY) ?? '';
    this.projectInput.value = localStorage.getItem(PROJECT_KEY) ?? '';
    this.annotatorInput.oninput = () => {
      localStorage.setItem(ANNOTATOR_KEY, this.annotatorInput.value);
      void this.refresh();
    };
    this.projectInput.oninput = () => localStorage.setItem(PROJECT_KEY, this.projectInput.value);
    this.renderCategoryButtons();
    host.querySelector<HTMLButtonElement>('#qc-export')!.onclick = () => void this.exportCsv();
    void this.updateCount();
  }

  private renderCategoryButtons(): void {
    this.labelsEl.replaceChildren();
    this.buttons = this.categories.map((category) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary quality-label-button';
      b.textContent = category;
      b.disabled = !this.image;
      b.onclick = () => void this.save(category);
      this.labelsEl.append(b);
      return b;
    });
    this.updateButtonStates();
  }

  /** Lets the companion `cytorecorder review` CLI's `?project=` URL
   * param prefill the field before any image is even loaded, without
   * clobbering a value the person already typed or had saved locally. */
  prefillProject(name: string): void {
    if (!name || this.projectInput.value) return;
    this.projectInput.value = name;
    localStorage.setItem(PROJECT_KEY, name);
  }

  /** Switches the panel to a newly shown whole image; undefined disables it
   * (nothing to label — e.g. back in single-objects mode). */
  setImage(image: { path: string; project: string } | undefined): void {
    this.image = image;
    if (image && !this.projectInput.value) this.projectInput.value = image.project;
    this.pathEl.textContent = image ? image.path : '';
    for (const b of this.buttons) b.disabled = !image;
    this.statusEl.textContent = '';
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.image || !this.annotatorInput.value.trim()) {
      this.current = undefined;
      this.updateButtonStates();
      return;
    }
    try {
      this.current = await this.store.get(
        qualityLabelId(this.image.path, this.annotatorInput.value.trim()),
      );
    } catch {
      this.current = undefined;
    }
    this.updateButtonStates();
  }

  private updateButtonStates(): void {
    for (const b of this.buttons)
      b.classList.toggle(
        'quality-label-selected',
        !!this.current && this.current.qualityLabel === b.textContent,
      );
    this.statusEl.textContent = this.current
      ? `Saved "${this.current.qualityLabel}" by ${this.current.annotator} at ${new Date(this.current.updatedAt).toLocaleString()}`
      : '';
  }

  private async save(category: string): Promise<void> {
    if (!this.image) return;
    const annotator = this.annotatorInput.value.trim();
    if (!annotator) {
      this.statusEl.textContent = 'Enter your name as the annotator before saving a label.';
      return;
    }
    try {
      const record = createQualityLabel(
        this.image.path,
        this.projectInput.value.trim(),
        annotator,
        category,
        this.current,
      );
      await this.store.put(record);
      this.current = record;
      this.updateButtonStates();
      await this.updateCount();
    } catch (e) {
      this.statusEl.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  private async updateCount(): Promise<void> {
    try {
      const all = await this.store.list();
      this.countEl.textContent = `${all.length} quality label${all.length === 1 ? '' : 's'} saved locally.`;
    } catch {
      this.countEl.textContent = '';
    }
  }

  private async exportCsv(): Promise<void> {
    try {
      const all = await this.store.list(),
        csv = exportQualityLabelsCsv(all),
        bytes = new TextEncoder().encode(csv);
      if (await this.saveViaPicker(bytes, all.length)) return;
      download(bytes, 'quality-labels.csv', 'text/csv');
    } catch (e) {
      this.statusEl.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  /** File System Access API: a native Save-As dialog with a suggested
   * filename, so exporting lands directly where the person picks (e.g. the
   * `cytorecorder review` CLI's printed output folder) with no
   * separate move-from-Downloads step. Returns false (never throws) when
   * the API is unavailable (Firefox, older Safari) so the caller falls back
   * to the plain download; a user-cancelled picker also counts as handled,
   * not a failure, since nothing was supposed to be written. */
  private async saveViaPicker(bytes: Uint8Array, count: number): Promise<boolean> {
    const picker = (
      window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;
    if (!picker) return false;
    try {
      const handle = await picker({
        suggestedName: 'quality_labels.csv',
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
      this.statusEl.textContent = `Saved ${count} quality label(s) to ${handle.name}.`;
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return true; // user cancelled
      return false; // any other failure: fall back to a plain download
    }
  }

  destroy(): void {
    this.store.close();
  }
}
