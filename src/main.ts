import './style.css';
import { parseView, withView, DEFAULT_VIEW, type ViewSettings } from './view';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  settingsUrl,
  validateSettings,
  type Pixels,
  type Settings,
} from './core';
import type { Cell, RunResult, Progress } from './pipeline';
import type { NgffMetadata, Alignment } from './sources/browser';
import type { NetworkProgress } from './sources/read-session';
import { datasetForSource, referenceForDate, REFERENCE_POOL, registerDataset } from './datasets';
import { LiveImageDiscovery, archiveImageId, describeArchiveSource } from './discovery';
import { drawCrop, seededOrder, composite } from './render';
import { download, cropArchive, provenance } from './exports';
import { MorphEmBackground } from './features/background';
import { MorphEmClient } from './features/client';
import { MORPHEM_PREPROCESSING } from './features/config';
import { VoiceNotesPanel } from './voice/VoiceNotesPanel';
import { associationKey, contextForCell, contextForCells } from './voice/context';
import type { FlatImage } from './sources/flat-image';
import { QualityPanel } from './quality/QualityPanel';
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
$('#app').innerHTML = `
<header class="topbar"><a class="wordmark" href="./"><img src="./logo.png" alt="CytoRecorder" class="logo" width="402" height="112"></a><button id="about-toggle" type="button" class="about-toggle"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.3"></circle><circle cx="8" cy="4.7" r="0.9" fill="currentColor"></circle><path d="M8 7.2v4.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path></svg>About</button><a class="source-link" href="https://github.com/WayScience/CytoRecorder" target="_blank" rel="noopener"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>Source</a></header>
<main class="settings-collapsed"><aside id="controls-panel" class="controls" hidden><div class="controls-heading"><button id="close-settings" type="button" class="secondary" aria-label="Hide settings">Hide ×</button></div>
<form id="settings"><label for="preset">Sample dataset</label><select id="preset"><option value="reference">BIA · discover a new image</option><option value="labels">IDR0076 · verified cell labels</option><option value="idr0033">IDR0033 · supplied source</option><option value="custom">Your OME-Zarr image</option></select>
<label for="source">OME-Zarr image-group URL</label><input id="source" name="source" type="url" required spellcheck="false"><p class="hint">An image group, not a plate or array. Direct HTTPS reads; no server upload.</p>
<button type="button" id="inspect" class="secondary full">Inspect metadata</button><div id="metadata" class="metadata" hidden></div>
<div class="two"><div><label for="reader">Image reader</label><select id="reader"><option value="duckdb-zarr">DuckDB-Zarr</option></select></div><div><label for="segmentation">Find objects with</label><select id="segmentation"><option value="classical">Classical baseline</option><option value="model">Pretrained nuclei model</option><option value="labels">Existing labels</option></select></div></div>
<p id="backend-note" class="hint">Threshold + connected components. A baseline, not validated cell segmentation.</p>
<div id="label-field" hidden><label for="labelPath">Label group name or HTTPS URL</label><input id="labelPath" placeholder="Auto-detect from image labels" spellcheck="false"></div>
<div class="three"><div><label for="level">Level</label><input id="level" type="number" min="0" max="12" step="1"></div><div><label for="t">Time index</label><input id="t" type="number" min="0" step="1"></div><div><label for="z">Z index</label><input id="z" type="number" min="0" step="1"></div></div>
<p class="plane-note">Exactly one Z slice. No volume. No projection.</p>
<div class="two"><div><label for="channels">Display channels</label><input id="channels" pattern="[0-9]+(,[0-9]+)*" placeholder="0,1,2"></div><div><label for="segmentChannel">Segment channel</label><input id="segmentChannel" type="number" min="0" step="1"></div></div>
<div class="section-label sampling-label">02 / SAMPLE</div><div class="two"><div><label for="tile">Tile width / height</label><select id="tile"><option value="128">128 px</option><option value="256">256 px</option><option value="512">512 px</option></select></div><div><label for="count">Tile budget / max</label><input id="count" type="number" min="1" max="32"></div></div>
<label for="target">Objects to collect</label><input id="target" type="number" min="1" max="1000"><div class="seed-row"><div><label for="seed">Random seed</label><input id="seed" maxlength="128"></div><button type="button" id="new-seed" class="secondary" aria-label="Choose a new random seed">↻</button></div>
<details class="advanced"><summary>Object limits & crop padding</summary><div class="three"><div><label for="minArea">Min area / px²</label><input id="minArea" type="number" min="0"></div><div><label for="maxArea">Max area / px²</label><input id="maxArea" type="number" min="0"></div><div><label for="padding">Padding / px</label><input id="padding" type="number" min="0" max="64"></div></div><div class="three"><div><label for="cropSize">Crop min / px</label><input id="cropSize" type="number" min="8" max="256"></div><div><label for="modelThreshold">Model probability</label><input id="modelThreshold" type="number" min="0" max="1" step="0.05"></div><div><label for="classicalThreshold">Raw threshold</label><input id="classicalThreshold" placeholder="Auto Otsu" type="number" step="any"></div></div><label class="check"><input id="excludeEdges" type="checkbox"> Exclude tile-edge objects</label><p class="hint">Edge objects may be incomplete. Measurements use original native intensities, not display colors.</p></details>
<div class="run-actions"><button id="run" type="submit" class="primary">Sample objects</button></div></form>
<div class="section-label display-label">03 / DISPLAY</div>
<div class="two"><div><label for="sort">Order</label><select id="sort"><option value="random">Seeded shuffle</option><option value="area-desc">Largest area first</option><option value="area-asc">Smallest area first</option><option value="intensity">Brightest first</option></select></div><div><label for="filter-area">Min area</label><input id="filter-area" type="number" min="0" value="0"></div></div>
<div class="two"><div><label for="filter-intensity">Min mean</label><input id="filter-intensity" type="number" value="0"></div><div><label for="contrast">Contrast</label><select id="contrast"><option value="auto">Per-crop percentile</option><option value="fixed">Fixed raw window</option></select></div></div>
<div class="two"><div><label for="display-low">Low</label><input id="display-low" type="number" value="0" step="any"></div><div><label for="display-high">High</label><input id="display-high" type="number" value="25000" step="any"></div></div>
<label for="size">Crop size</label><input id="size" type="range" min="72" max="180" value="112">
<div class="two"><label class="check"><input id="overlay" type="checkbox"> Outlines</label><label class="check"><input id="context" type="checkbox" checked> Context</label></div>
</aside>
<section class="workspace" aria-label="Object mosaic"><section id="image-biology" aria-label="Biological context"><h1 id="image-title"></h1><p id="image-description"></p><p id="image-attribution"></p><p id="image-plane" class="hint"></p></section><div class="mosaic-header"><div class="mosaic-actions"><button id="controls-toggle" type="button" class="secondary" aria-controls="controls-panel" aria-expanded="false" aria-label="Show settings"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><line x1="2" y1="4" x2="14" y2="4"></line><circle cx="6" cy="4" r="1.6" fill="currentColor" stroke="none"></circle><line x1="2" y1="8" x2="14" y2="8"></line><circle cx="10" cy="8" r="1.6" fill="currentColor" stroke="none"></circle><line x1="2" y1="12" x2="14" y2="12"></line><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"></circle></svg><span>Settings</span></button><button id="shuffle" type="button" class="primary"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5"></rect><circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="10.5" cy="10.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"></circle></svg><span>Random image</span></button><button id="upload" type="button" class="secondary"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 10V2M8 2L5 5M8 2l3 3" stroke-linecap="round" stroke-linejoin="round"></path><path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"></path></svg><span>Upload folder</span></button><input id="upload-input" type="file" webkitdirectory multiple hidden aria-hidden="true" tabindex="-1"><button id="upload-image" type="button" class="secondary"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 10V2M8 2L5 5M8 2l3 3" stroke-linecap="round" stroke-linejoin="round"></path><path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"></path></svg><span>Upload image (PNG/TIFF)</span></button><input id="upload-image-input" type="file" accept=".png,.tif,.tiff,image/png,image/tiff" hidden aria-hidden="true" tabindex="-1"></div>
<div class="view-mode-toggle" role="group" aria-label="View mode"><button id="mode-objects" type="button" class="secondary" aria-pressed="true">Single objects</button><button id="mode-image" type="button" class="secondary" aria-pressed="false">Single image</button></div></div>
<div id="status" class="status" role="status" aria-live="polite" hidden></div><div id="reading-progress" class="reading-progress" hidden><div class="reading-heading"><span>Image / label transfer</span><span id="read-elapsed">0.0 s</span></div><progress id="progress" max="1" aria-label="Image and label download progress" aria-describedby="read-summary" title="Download totals cover discovered requests, not an estimated overall job size"></progress><div id="read-summary" class="read-summary">Waiting for the source…</div><div id="read-file" class="read-file"></div></div>
<div class="hint" id="morphem-panel" hidden><span id="morphem-status" role="status" aria-live="polite"></span> <button id="morphem-pause" type="button" class="secondary">Pause features</button><button id="morphem-retry" type="button" class="secondary" hidden>Retry features</button></div><div id="metrics" class="metrics" hidden></div><div id="warnings" class="warnings" hidden></div>
<div class="result-count" id="result-count" role="status" aria-live="polite">No objects sampled yet</div>
<div class="channel-legend-row"><span class="channel-legend-heading">Channels</span><div id="channel-legend" class="channel-legend"></div></div><details id="whole-preview" class="whole-preview" hidden><summary>Whole image preview</summary><div class="whole-preview-body"><canvas id="whole-preview-canvas" aria-label="Downsampled whole image preview"></canvas><p id="whole-preview-note" class="hint"></p></div></details>
<div id="image-queue-nav" class="image-queue-nav" hidden><button id="image-prev" type="button" class="secondary">◀ Prev</button><span id="image-queue-position" class="hint"></span><button id="image-next" type="button" class="secondary">Next ▶</button></div>
<div id="multi-select-bar" class="multi-select-bar" hidden><span id="multi-select-count"></span><button id="multi-select-annotate" type="button" class="primary">Annotate selected</button><button id="multi-select-clear" type="button" class="secondary">Clear selection</button></div>
<div id="mosaic-scroll" class="mosaic-scroll" tabindex="0" aria-label="Scrollable single-object mosaic"><div id="empty" class="empty"><span class="empty-glyph" aria-hidden="true">▦</span><p>Small samples.<br>Unexpected details.</p><span>Choose a source, a plane, and a seed.</span></div><div id="mosaic" role="grid" aria-label="Single-object image crops"></div></div>
<div class="mosaic-caption">Each tile is one object-centered crop, shown in grayscale with a green outline on the focused instance. Click or press Enter to inspect. A blue tile border means it already has a saved note. Use the corner checkbox to select several objects for one batch voice note. Display contrast is per crop; means are measured on raw pixels.</div>
<p class="credit" id="credit">Default: IDR0076, Ali et al., CC BY 4.0. Verified 2D tissue cell labels. Display override: channel 42, DNA1-191Ir. Images hosted by IDR / EMBL-EBI.</p><div class="export-row"><span>Export this view</span><button id="csv" class="secondary" disabled>CSV</button><button id="parquet" class="secondary" disabled>Parquet</button><button id="raw" class="secondary" disabled>Native crops ZIP</button><button id="mosaic-png" class="secondary" disabled>Mosaic PNG</button><button id="manifest" class="secondary" disabled>Run JSON</button></div>
<section id="voice-notes" aria-label="Local voice notes"></section><section id="quality-panel" aria-label="Whole-image quality annotation" hidden></section><pre id="run-details" hidden>No run yet.</pre></section></main>
<dialog id="about"><div class="dialog-head"><h2>About</h2><button id="close-about" class="secondary" aria-label="Close about dialog">Close ×</button></div><p>CytoRecorder samples single-plane, single-object crops from large OME-NGFF / IDR microscopy images, directly in the browser. No image data is uploaded to a server.</p><p class="about-tech">Built with <a href="https://ngff.openmicroscopy.org/" target="_blank" rel="noopener">OME-NGFF / OME-Zarr</a>, the chunked, cloud-native image format read here; <a href="https://github.com/xqlsystems/duckdb-zarr" target="_blank" rel="noopener">DuckDB-Zarr</a>, which decodes original Zarr chunks and reads image and label pixels through SQL in WASM, with bounded browser downloads feeding complete single-chunk in-memory views and preserved source coordinates; <a href="https://duckdb.org/docs/api/wasm/overview" target="_blank" rel="noopener">DuckDB-WASM</a>, the local SQL engine behind the CSV/Parquet export; <a href="https://onnxruntime.ai/docs/tutorials/web/" target="_blank" rel="noopener">ONNX Runtime Web</a>, which runs the pretrained StarDist nuclei model client-side; <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noopener">Transformers.js</a> and <a href="https://huggingface.co/onnx-community/whisper-tiny.en" target="_blank" rel="noopener">Whisper Tiny English</a> for optional local voice transcription in a dedicated worker — model downloads happen on first transcription, not page load, and notes are saved only in this browser’s IndexedDB with audio never stored or uploaded; <a href="https://github.com/101arrowz/fflate" target="_blank" rel="noopener">fflate</a> for native-crop ZIP archive export; and <a href="https://vite.dev/" target="_blank" rel="noopener">Vite</a> plus <a href="https://www.typescriptlang.org/" target="_blank" rel="noopener">TypeScript</a> for build tooling and app code.</p><p class="hint">Source: <a href="https://github.com/WayScience/CytoRecorder" target="_blank" rel="noopener">github.com/WayScience/CytoRecorder</a></p></dialog>`;
const archiveDiscovery = new LiveImageDiscovery();
let discoveryAbort: AbortController | undefined;
let settings: Settings;
let initialSettingsValid = true;
const dayReference = referenceForDate(
  new Date(),
  new URL(location.href).searchParams.get('reference'),
);
try {
  settings = parseSettings(location.href, dayReference);
} catch (e) {
  initialSettingsValid = false;
  settings = { ...dayReference, channels: [...dayReference.channels] };
  setStatus(String(e), true);
}
const hiddenChannels = new Set<number>();
let localFiles: Map<string, File> | undefined;
let result: RunResult | undefined,
  visible: Cell[] = [],
  selected: Cell | undefined,
  worker: Worker | undefined,
  generation = 0,
  dbReady = false,
  gridFrame = 0,
  runStarted = 0,
  firstBatchMs = 0,
  running = false;
let previewWorker: Worker | undefined,
  previewGeneration = 0,
  previewLoadedFor: RunResult | undefined;
const voiceCounts = new Map<string, number>();
const multiSelected = new Set<string>();
let labelOptions: string[] = [];
let viewMode: 'objects' | 'image' = 'objects';
let flatImage: FlatImage | undefined;
/** A folder of many flat PNG/TIFF files (recursively, including subdirs) steps
 * through them one at a time in single-image mode, driving whole-image QC
 * labeling across a dataset rather than just one file. */
let imageQueue: { path: string; file: File }[] = [];
let imageQueueIndex = 0;
let imageQueueProject = '';
const qcCategories = (() => {
  const raw = new URL(location.href).searchParams.get('qc-labels');
  return raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
})();
let featurePreparation: Promise<void> = Promise.resolve();
const morphem = new MorphEmBackground(new MorphEmClient(), (state) => {
  $('#morphem-panel').hidden = state.phase === 'idle';
  $('#morphem-status').textContent =
    state.phase === 'complete'
      ? `MorphEm ready: ${state.completed} objects embedded; features included in CSV/Parquet exports.`
      : state.phase === 'error'
        ? `MorphEm unavailable: ${state.error} (${state.completed}/${state.total} ready).`
        : `MorphEm: embedded ${state.completed}/${state.total} objects${state.phase === 'paused' ? ' · paused' : ' in the background…'}`;
  button('morphem-retry').hidden = state.phase !== 'error';
  button('morphem-pause').hidden = state.phase === 'complete' || state.phase === 'error';
});
let manuallyPaused = false;
button('morphem-pause').onclick = () => {
  manuallyPaused = !manuallyPaused;
  if (manuallyPaused) morphem.pause('manual');
  else morphem.resume('manual');
  button('morphem-pause').textContent = manuallyPaused ? 'Resume features' : 'Pause features';
};
button('morphem-retry').onclick = () => morphem.retry();
window.addEventListener('pagehide', () => {
  discoveryAbort?.abort();
  morphem.stop();
});
const voiceNotes = new VoiceNotesPanel($('#voice-notes'), {
  onClose: () => {
    morphem.resume('voice');
    $('#object-details').hidden = true;
  },
  prepareRecording: () => {
    if (running)
      throw Error(
        'Wait for image processing to finish, or cancel it before recording. Manual notes remain available.',
      );
    // Results/crops stay intact; release the idle StarDist session before ASR
    // allocates its own, and pause background MorphEm featurization (it shares
    // the ORT-WASM runtime with ASR; ASR must not compete for it).
    worker?.terminate();
    worker = undefined;
    morphem.pause('voice');
  },
  onChange: (notes) => {
    voiceCounts.clear();
    for (const note of notes)
      for (const id of note.selectedCellIds) {
        const key = associationKey(note, id);
        voiceCounts.set(key, (voiceCounts.get(key) ?? 0) + 1);
      }
    renderGrid();
    if (result && dbReady) {
      const run = result,
        labelsByCell = new Map<string, string>();
      for (const cell of run.cells) {
        if (labelsByCell.has(cell.cell_id)) continue;
        const key = associationKey(contextForCell(cell), cell.cell_id),
          match = notes.find(
            (note) =>
              note.annotationLabel &&
              note.selectedCellIds.includes(cell.cell_id) &&
              associationKey(note, cell.cell_id) === key,
          );
        if (match) labelsByCell.set(cell.cell_id, match.annotationLabel!);
      }
      void import('./database').then(({ syncLabels }) => syncLabels(run.cells, labelsByCell));
    }
  },
});
const qualityPanel = new QualityPanel($('#quality-panel'), { categories: qcCategories });
function setStatus(text: string, error = false) {
  $('#status').textContent = text;
  $('#status').hidden = !text;
  $('#status').classList.toggle('error', error);
}
function readView(): ViewSettings {
  return {
    sort: select('sort').value as ViewSettings['sort'],
    area: Number(input('filter-area').value) || 0,
    mean: Number(input('filter-intensity').value) || 0,
    overlay: input('overlay').checked,
    context: input('context').checked,
    size: Number(input('size').value),
    contrast: select('contrast').value as ViewSettings['contrast'],
    low: Number(input('display-low').value),
    high: Number(input('display-high').value),
    hiddenChannels: [...hiddenChannels],
    labelOptions: [...labelOptions],
  };
}
function input(id: string) {
  return $<HTMLInputElement>(`#${id}`);
}
function select(id: string) {
  return $<HTMLSelectElement>(`#${id}`);
}
function button(id: string) {
  return $<HTMLButtonElement>(`#${id}`);
}
function renderBiology(source: string) {
  const sample = datasetForSource(source);
  $('#image-title').textContent = sample?.biology?.title ?? sample?.name ?? 'Custom OME-Zarr image';
  $('#image-description').textContent =
    sample?.biology?.description ??
    sample?.semantics ??
    'Biological metadata has not been curated for this image. Consult its source study.';
  const attribution = $('#image-attribution');
  attribution.replaceChildren(
    document.createTextNode(sample?.attribution ?? 'User-supplied source.'),
  );
  for (const [text, href] of [
    ['Source study', sample?.biology?.studyUrl],
    ['Publication', sample?.biology?.publicationUrl],
  ]) {
    if (!href) continue;
    const link = document.createElement('a');
    link.textContent = text!;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    attribution.append(' · ', link);
  }
  $('#credit').textContent = sample
    ? `${sample.attribution}. ${sample.semantics}.`
    : 'Custom image: biological context and reuse terms must be checked with its provider.';
  $('#image-plane').textContent = '';
}
function fill(s: Settings) {
  renderBiology(s.source);
  for (const [key, value] of Object.entries(s)) {
    const element = document.getElementById(key) as HTMLInputElement;
    if (!element) continue;
    if (typeof value === 'boolean') element.checked = value;
    else element.value = Array.isArray(value) ? value.join(',') : String(value);
  }
  backendNote();
}
function readSettings(): Settings {
  const s = { ...settings };
  for (const key of Object.keys(s) as (keyof Settings)[]) {
    const element = document.getElementById(key) as HTMLInputElement;
    if (!element) continue;
    const v = element.value.trim();
    if (key === 'channels') s.channels = v.split(',').map(Number);
    else if (typeof s[key] === 'boolean')
      (s as unknown as Record<string, unknown>)[key] = element.checked;
    else if (typeof s[key] === 'number') (s as unknown as Record<string, unknown>)[key] = Number(v);
    else (s as unknown as Record<string, unknown>)[key] = v;
  }
  return validateSettings(s);
}
function backendNote() {
  const backend = select('segmentation').value;
  $('#label-field').hidden = backend !== 'labels';
  $('#backend-note').textContent =
    backend === 'labels'
      ? 'Instance IDs must align with the selected image level and plane.'
      : backend === 'model'
        ? 'A pretrained 2D nuclei model. Nuclei are not whole-cell boundaries.'
        : 'Threshold + connected components. A baseline, not validated cell segmentation.';
}
function setSettingsOpen(open: boolean) {
  const panel = $('#controls-panel'),
    toggle = button('controls-toggle');
  panel.hidden = !open;
  $('main').classList.toggle('settings-collapsed', !open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Hide settings' : 'Show settings');
  if (open) select('preset').focus();
  else toggle.focus();
}
button('controls-toggle').onclick = () => setSettingsOpen($('#controls-panel').hidden);
button('close-settings').onclick = () => setSettingsOpen(false);
button('about-toggle').onclick = () => $<HTMLDialogElement>('#about').showModal();
button('close-about').onclick = () => $<HTMLDialogElement>('#about').close();
fill(settings);
if (!initialSettingsValid)
  renderBiology(new URL(location.href).searchParams.get('source') ?? settings.source);
try {
  const v = parseView(location.href);
  select('sort').value = v.sort;
  input('filter-area').value = String(v.area);
  input('filter-intensity').value = String(v.mean);
  input('overlay').checked = v.overlay;
  input('context').checked = v.context;
  input('size').value = String(v.size);
  select('contrast').value = v.contrast;
  input('display-low').value = String(v.low);
  input('display-high').value = String(v.high);
  v.hiddenChannels.forEach((c) => hiddenChannels.add(c));
  labelOptions = v.labelOptions;
  voiceNotes.setLabelOptions(labelOptions);
} catch (e) {
  initialSettingsValid = false;
  setStatus(`Invalid display state: ${e instanceof Error ? e.message : e}`, true);
}
select('preset').value = REFERENCE_POOL.some((s) => s.url === settings.source)
  ? 'reference'
  : settings.source === DEFAULT_SETTINGS.source
    ? 'labels'
    : datasetForSource(settings.source)?.id === 'idr0033-BR00109990-C2-0'
      ? 'idr0033'
      : 'custom';
select('segmentation').onchange = backendNote;
button('new-seed').onclick = () => {
  input('seed').value = crypto.getRandomValues(new Uint32Array(1))[0].toString();
};
select('preset').onchange = () => {
  const choice = select('preset').value;
  if (choice === 'reference') {
    void pullNewImage();
    return;
  }
  if (choice === 'custom') {
    input('source').focus();
    return;
  }
  settings = {
    ...DEFAULT_SETTINGS,
    ...(choice === 'idr0033'
      ? {
          source: 'https://livingobjects.ebi.ac.uk/idr/zarr/v0.5/idr0033A/BR00109990_C2.zarr/0/',
          segmentation: 'model' as const,
          labelPath: '',
          channels: [0, 1, 2],
          segmentChannel: 0,
          cropSize: 64,
        }
      : { channels: [42] }),
  };
  fill(settings);
  $('#metadata').hidden = true;
  $('#channel-legend').replaceChildren();
  start('run');
};
let readNetwork: NetworkProgress | undefined;
let readingTimer: ReturnType<typeof setInterval> | undefined;
function byteText(bytes: number) {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(2)} MiB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${bytes} B`;
}
function renderReadingProgress() {
  if (!running) return;
  $('#read-elapsed').textContent = `${((performance.now() - runStarted) / 1000).toFixed(1)} s`;
  const bar = $<HTMLProgressElement>('#progress'),
    p = readNetwork;
  if (!p) {
    bar.removeAttribute('value');
    $('#read-summary').textContent = 'Waiting for the source…';
    $('#read-file').textContent = '';
    return;
  }
  const known = p.totalBytes !== null && p.totalBytes > 0 && p.totalBytes >= p.receivedBytes;
  if ((p.active || p.queued) && known) bar.value = p.receivedBytes / p.totalBytes!;
  else bar.removeAttribute('value');
  const summary = `${byteText(p.receivedBytes)} received${known ? ` / ${byteText(p.totalBytes!)} discovered` : ''} · ${p.active} active · ${p.queued} queued · ${p.completed} requests finished${p.retries ? ` · ${p.retries} retries` : ''}`;
  $('#read-summary').textContent = summary;
  bar.setAttribute('aria-valuetext', summary);
  $('#read-file').textContent = p.files
    .map((url) => new URL(url).pathname.split('/').slice(-4).join('/'))
    .join(' · ');
}
function busy(value: boolean) {
  running = value;
  button('run').disabled = value;
  button('inspect').disabled = value;
  button('shuffle').disabled = value;
  $('#progress').hidden = !value;
  $('#reading-progress').hidden = !value;
  if (readingTimer !== undefined) {
    clearInterval(readingTimer);
    readingTimer = undefined;
  }
  if (value) {
    renderReadingProgress();
    readingTimer = setInterval(renderReadingProgress, 200);
  }
}
function stop(terminate = true) {
  discoveryAbort?.abort();
  discoveryAbort = undefined;
  morphem.resume('discovery');
  generation++;
  if (terminate) {
    worker?.terminate();
    worker = undefined;
  }
  busy(false);
}
button('shuffle').onclick = () => void pullNewImage();
async function pullNewImage(rememberCurrent = true) {
  if (voiceNotes.isBusy) {
    setStatus('Finish or cancel the voice task before loading another image.', true);
    return;
  }
  stop();
  if (rememberCurrent) archiveDiscovery.remember(settings.source);
  if (!result) {
    $('#image-title').textContent = 'Discovering a new BioImage Archive image…';
    $('#image-description').textContent =
      'Searching for a new fluorescence dataset with reader-compatible OME-Zarr metadata.';
    $('#image-attribution').replaceChildren();
    $('#image-plane').textContent = '';
    $('#credit').textContent = 'Live BioImage Archive discovery';
  }
  morphem.pause('discovery');
  const controller = new AbortController();
  discoveryAbort = controller;
  busy(true);
  try {
    const next = await archiveDiscovery.next(controller.signal, (message) => setStatus(message));
    if (controller.signal.aborted || discoveryAbort !== controller) return;
    registerDataset(next.sample);
    settings = next.settings;
    fill(settings);
    select('preset').value = 'reference';
    $('#metadata').hidden = true;
    $('#channel-legend').replaceChildren();
    discoveryAbort = undefined;
    morphem.resume('discovery');
    start('run');
  } catch (error) {
    if (controller.signal.aborted || discoveryAbort !== controller) return;
    setStatus(
      `Archive discovery unavailable: ${error instanceof Error ? error.message : String(error)} ${result ? 'Current image kept;' : 'No image loaded;'} no old dataset was substituted.`,
      true,
    );
  } finally {
    if (discoveryAbort === controller) {
      discoveryAbort = undefined;
      morphem.resume('discovery');
      busy(false);
    }
  }
}
type LegacyDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};
async function readDirectoryEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader(),
    all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
}
async function collectEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: Map<string, File>,
): Promise<void> {
  const key = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.set(key, file);
  } else if (entry.isDirectory) {
    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) await collectEntry(child, key, out);
  }
}
function isFlatImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.tif') || lower.endsWith('.tiff');
}
/** A single dropped PNG/TIFF file is a flat image (no directory structure to
 * index by key); otherwise, only dropped directory entries are indexed. */
async function filesFromDrop(
  items: DataTransferItemList,
): Promise<
  | { kind: 'folder'; label: string; files: Map<string, File> }
  | { kind: 'image'; file: File }
  | undefined
> {
  const entries: FileSystemEntry[] = [];
  for (const item of items) {
    const entry = (item as LegacyDataTransferItem).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 1 && entries[0].isFile && isFlatImageName(entries[0].name)) {
    const file = await new Promise<File>((resolve, reject) =>
      (entries[0] as FileSystemFileEntry).file(resolve, reject),
    );
    return { kind: 'image', file };
  }
  const out = new Map<string, File>();
  let label = '';
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    label ||= entry.name;
    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) await collectEntry(child, '', out);
  }
  return out.size ? { kind: 'folder', label: label || 'upload', files: out } : undefined;
}
function filesFromFileList(
  fileList: FileList | null,
): { label: string; files: Map<string, File> } | undefined {
  if (!fileList?.length) return undefined;
  const out = new Map<string, File>();
  let label = '';
  for (const file of Array.from(fileList)) {
    const relative =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      parts = relative.split('/');
    label ||= parts[0] || 'upload';
    out.set(parts.length > 1 ? parts.slice(1).join('/') : parts[0], file);
  }
  return out.size ? { label, files: out } : undefined;
}
/** No server upload: files are read directly in the browser and opened like any other source.
 * "Existing labels" segmentation would need a second openImageSource call resolved
 * relative to the source URL, which only the HTTP backend supports; local uploads use
 * the pretrained model (or classical baseline, if already selected) instead. */
function openLocalImage(label: string, files: Map<string, File>): void {
  if (!files.size) {
    setStatus('No files found in the dropped or selected folder.', true);
    return;
  }
  discoveryAbort?.abort();
  discoveryAbort = undefined;
  morphem.resume('discovery');
  localFiles = files;
  settings = {
    ...settings,
    source: `local://${encodeURIComponent(label)}/`,
    segmentation: settings.segmentation === 'labels' ? 'model' : settings.segmentation,
  };
  fill(settings);
  select('preset').value = 'custom';
  $('#metadata').hidden = true;
  $('#channel-legend').replaceChildren();
  start('run');
}
/** Flat images never run the sampling/segmentation pipeline: no server upload,
 * no pyramid, no objects. "Single image" mode is the only available view. */
async function openFlatImage(file: File): Promise<void> {
  if (voiceNotes.isBusy) {
    setStatus('Finish or cancel the voice task before loading an image.', true);
    return;
  }
  await openImageQueueInternal([{ path: file.name, file }], file.name);
}
/** A folder containing no Zarr group marker but at least one PNG/TIFF file,
 * anywhere in its subdirectories, is a batch of whole images to review one at
 * a time (the issue's "Add whole-image quality annotation workflow"), not an
 * OME-Zarr pyramid. A folder matching neither falls through to the existing
 * Zarr path, which still fails with its own clear error for junk folders. */
function classifyLocalFolder(files: Map<string, File>): 'zarr' | 'images' {
  for (const key of files.keys()) {
    const base = key.split('/').pop() ?? '';
    if (
      base === '.zgroup' ||
      base === '.zattrs' ||
      base === 'zarr.json' ||
      base.endsWith('.zarray')
    )
      return 'zarr';
  }
  for (const key of files.keys()) if (isFlatImageName(key)) return 'images';
  return 'zarr';
}
async function openImageQueue(label: string, files: Map<string, File>): Promise<void> {
  if (voiceNotes.isBusy) {
    setStatus('Finish or cancel the voice task before loading images.', true);
    return;
  }
  const entries = [...files.entries()]
    .filter(([key]) => isFlatImageName(key))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, file]) => ({ path, file }));
  if (!entries.length) {
    setStatus('No PNG/TIFF images found in that folder.', true);
    return;
  }
  await openImageQueueInternal(entries, label);
}
function decodeQueueItem(item: { path: string; file: File }): Promise<FlatImage> {
  setStatus(`Decoding ${item.path}…`);
  return import('./sources/flat-image').then(({ decodeFlatImage }) => decodeFlatImage(item.file));
}
function applyDecodedImage(image: FlatImage, item: { path: string }, index: number): void {
  flatImage = image;
  hiddenChannels.clear();
  $('#image-title').textContent =
    imageQueue.length > 1 ? `${item.path} (${index + 1} of ${imageQueue.length})` : item.path;
  renderFlatChannelLegend(image);
  updateImageQueueNav();
}
/** Decodes the first image before touching any shared state: a corrupt file
 * must not wipe out whatever was already loaded (mirrors how a failed Zarr
 * open or voice action never destroys the current run either). */
async function openImageQueueInternal(
  entries: { path: string; file: File }[],
  project: string,
): Promise<void> {
  try {
    const image = await decodeQueueItem(entries[0]);
    stop(running);
    clearResults();
    localFiles = undefined;
    imageQueue = entries;
    imageQueueIndex = 0;
    imageQueueProject = project;
    settings = { ...settings, source: `local://${encodeURIComponent(project)}/` };
    fill(settings);
    select('preset').value = 'custom';
    applyDecodedImage(image, entries[0], 0);
    $('#image-description').textContent =
      'Local flat image file(s) (PNG/TIFF), not OME-NGFF: no physical scale, no channel metadata beyond TIFF pages, and no object segmentation in this mode.';
    $('#image-attribution').replaceChildren();
    $('#image-plane').textContent = '';
    $('#credit').textContent =
      'Local file: biological context and reuse terms must be checked with its provider.';
    setViewModeAvailability(false);
    viewMode = 'image';
    applyViewMode();
    setStatus('');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}
/** Stepping within an already-open queue: never calls clearResults(), so the
 * queue, project, and view mode survive a Prev/Next click untouched. */
async function loadQueueImage(index: number): Promise<void> {
  const item = imageQueue[index];
  if (!item) return;
  try {
    const image = await decodeQueueItem(item);
    imageQueueIndex = index;
    applyDecodedImage(image, item, index);
    applyViewMode();
    setStatus('');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}
function updateImageQueueNav(): void {
  const multiple = imageQueue.length > 1;
  $('#image-queue-nav').hidden = !multiple;
  if (multiple)
    $('#image-queue-position').textContent = `${imageQueueIndex + 1} of ${imageQueue.length}`;
  button('image-prev').disabled = imageQueueIndex === 0;
  button('image-next').disabled = imageQueueIndex === imageQueue.length - 1;
}
function drawFlatImagePreview(image: FlatImage): void {
  const canvas = $<HTMLCanvasElement>('#whole-preview-canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  if (image.kind === 'rgb') {
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height),
      0,
      0,
    );
  } else {
    const colorsFor = image.channels.map((_, i) => (hiddenChannels.has(i) ? '000000' : 'FFFFFF')),
      pixels = composite(image.channels, image.width, image.height, colorsFor);
    context.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), image.width, image.height),
      0,
      0,
    );
  }
  $('#whole-preview-note').textContent =
    image.kind === 'rgb'
      ? `${image.width} × ${image.height} px · ${image.name}`
      : `${image.width} × ${image.height} px · ${image.channels.length} page(s) · ${image.name}`;
}
/** Not the OME-Zarr `#channel-legend` population path: a flat TIFF's pages
 * have no NGFF channel metadata, only a per-page index to toggle on/off. */
function renderFlatChannelLegend(image: FlatImage): void {
  const legend = $('#channel-legend');
  legend.replaceChildren();
  if (image.kind !== 'channels') return;
  image.channelNames.forEach((name, i) => {
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !hiddenChannels.has(i);
    toggle.setAttribute('aria-label', `Display ${name}`);
    toggle.onchange = () => {
      if (toggle.checked) hiddenChannels.delete(i);
      else hiddenChannels.add(i);
      if (flatImage === image) drawFlatImagePreview(image);
    };
    const span = document.createElement('span'),
      swatch = document.createElement('i');
    swatch.style.background = '#FFFFFF';
    span.title = `${name}: one grayscale TIFF page, not an OME-NGFF channel.`;
    span.append(toggle, swatch, name);
    legend.append(span);
  });
}
function setViewModeAvailability(objectsAvailable: boolean): void {
  button('mode-objects').disabled = !objectsAvailable;
}
/** "Recording audio" (per-object voice notes) stays the default objects-mode
 * capability; single-image mode is instead the whole-image QC labeling
 * workflow (issue: "Add whole-image quality annotation workflow") — the two
 * panels are mutually exclusive, matching the two mutually exclusive views. */
function applyViewMode(): void {
  const isImage = viewMode === 'image';
  $('#mosaic-scroll').hidden = isImage;
  $('.mosaic-caption').hidden = isImage;
  $('#multi-select-bar').hidden = isImage || multiSelected.size === 0;
  $<HTMLDetailsElement>('#whole-preview').classList.toggle('primary', isImage);
  button('mode-objects').setAttribute('aria-pressed', String(!isImage));
  button('mode-image').setAttribute('aria-pressed', String(isImage));
  $('#voice-notes').hidden = isImage;
  $('#quality-panel').hidden = !isImage;
  if (isImage) {
    $<HTMLDetailsElement>('#whole-preview').hidden = false;
    $<HTMLDetailsElement>('#whole-preview').open = true;
    if (flatImage) drawFlatImagePreview(flatImage);
    else if (result) loadWholePreview();
    const item = imageQueue[imageQueueIndex];
    qualityPanel.setImage(item ? { path: item.path, project: imageQueueProject } : undefined);
    updateImageQueueNav();
  } else {
    if (!result) $<HTMLDetailsElement>('#whole-preview').hidden = true;
    $('#image-queue-nav').hidden = true;
    qualityPanel.setImage(undefined);
  }
}
button('mode-objects').onclick = () => {
  if (viewMode === 'objects' || button('mode-objects').disabled) return;
  viewMode = 'objects';
  applyViewMode();
};
button('mode-image').onclick = () => {
  if (viewMode === 'image') return;
  viewMode = 'image';
  applyViewMode();
};
button('image-prev').onclick = () => void loadQueueImage(imageQueueIndex - 1);
button('image-next').onclick = () => void loadQueueImage(imageQueueIndex + 1);
button('upload').onclick = () => $<HTMLInputElement>('#upload-input').click();
$<HTMLInputElement>('#upload-input').onchange = () => {
  const input = $<HTMLInputElement>('#upload-input'),
    collected = filesFromFileList(input.files);
  input.value = '';
  if (!collected) return;
  if (classifyLocalFolder(collected.files) === 'images')
    void openImageQueue(collected.label, collected.files);
  else openLocalImage(collected.label, collected.files);
};
button('upload-image').onclick = () => $<HTMLInputElement>('#upload-image-input').click();
$<HTMLInputElement>('#upload-image-input').onchange = () => {
  const input = $<HTMLInputElement>('#upload-image-input'),
    file = input.files?.[0];
  input.value = '';
  if (file) void openFlatImage(file);
};
const dropTarget = $('#mosaic-scroll');
for (const type of ['dragenter', 'dragover'])
  dropTarget.addEventListener(type, (event) => {
    if (!(event as DragEvent).dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dropTarget.classList.add('drag-over');
  });
for (const type of ['dragleave', 'dragend'])
  dropTarget.addEventListener(type, () => dropTarget.classList.remove('drag-over'));
dropTarget.addEventListener('drop', (event) => {
  event.preventDefault();
  dropTarget.classList.remove('drag-over');
  const items = (event as DragEvent).dataTransfer?.items;
  if (!items?.length) return;
  void (async () => {
    const collected = await filesFromDrop(items);
    if (collected?.kind === 'image') void openFlatImage(collected.file);
    else if (collected?.kind === 'folder') {
      if (classifyLocalFolder(collected.files) === 'images')
        void openImageQueue(collected.label, collected.files);
      else openLocalImage(collected.label, collected.files);
    } else setStatus('Drop an OME-Zarr folder or PNG/TIFF image file(s).', true);
  })();
});
function displayMetadata(
  metadata: NgffMetadata,
  alignment: Alignment,
  dtype?: string,
  chunks?: number[],
  showPlane = true,
) {
  const objects =
    settings.segmentation === 'model'
      ? 'Exploratory predicted nuclei, not whole-cell boundaries.'
      : settings.segmentation === 'classical'
        ? 'Threshold-connected components, not validated cells.'
        : 'Archive-supplied instance labels.';
  if (showPlane)
    $('#image-plane').textContent =
      `Selected ${settings.channels.map((c) => metadata.channels[c]?.name ?? `channel ${c}`).join(', ')} · level ${settings.level} · Z ${settings.z} · time ${settings.t}. One plane, not a projection. ${objects}`;
  const dims = alignment.axes.map((name, i) => `${name} ${alignment.shape[i]}`).join(' · ');
  $('#metadata').textContent =
    `${dims}\n${metadata.levels.length} levels · NGFF ${metadata.version}${dtype ? ` · ${dtype}` : ''}${chunks ? `\nChunks: ${chunks.join(' × ')}` : ''}`;
  $('#metadata').hidden = false;
  for (const name of ['t', 'z']) {
    const i = alignment.axes.indexOf(name);
    input(name).max = String(i < 0 ? 0 : alignment.shape[i] - 1);
  }
  input('level').max = String(metadata.levels.length - 1);
  const legend = $('#channel-legend');
  legend.replaceChildren();
  metadata.channels.forEach((channel, i) => {
    if (!settings.channels.includes(i)) return;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !hiddenChannels.has(i);
    toggle.setAttribute('aria-label', `Display channel ${i} ${channel.name}`);
    toggle.onchange = () => {
      if (toggle.checked) hiddenChannels.delete(i);
      else hiddenChannels.add(i);
      renderGrid();
      if (selected) drawInspector();
      if (result && previewLoadedFor === result && previewData)
        drawWholePreview(result, previewData);
    };
    const span = document.createElement('span'),
      swatch = document.createElement('i');
    swatch.style.background = '#FFFFFF';
    span.title = `${channel.name}: grayscale display; source metadata color #${channel.color}`;
    span.append(toggle, swatch, `${i} · ${channel.name}`);
    legend.append(span);
  });
}
function start(action: 'run' | 'inspect') {
  if (voiceNotes.isBusy) {
    setStatus('Finish or cancel the voice task before starting image processing.', true);
    return;
  }
  let s: Settings;
  try {
    s = readSettings();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
    return;
  }
  stop(running);
  runStarted = performance.now();
  firstBatchMs = 0;
  readNetwork = undefined;
  settings = s;
  renderBiology(s.source);
  history.replaceState(null, '', withView(settingsUrl(settings, location.href), readView()));
  busy(true);
  const id = ++generation;
  setStatus(
    action === 'inspect'
      ? 'Reading source metadata…'
      : 'Opening image. Only requested plane tiles will be read.',
  );
  $<HTMLProgressElement>('#progress').removeAttribute('value');
  if (action === 'run') {
    clearResults();
    $('#empty').hidden = false;
    $('#empty').querySelector('p')!.textContent = 'Reading small regions…';
    renderGrid();
  }
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onerror = (event) => {
    if (id !== generation) return;
    stop();
    setStatus(`Worker error: ${event.message}`, true);
  };
  worker.onmessage = (event) => {
    if (event.data.id !== generation) return;
    const { type, data } = event.data;
    if (type === 'network') {
      readNetwork = data;
      renderReadingProgress();
    } else if (type === 'progress') {
      const p = data as Progress;
      setStatus(`${p.stage} · ${p.cells} objects`);
      renderReadingProgress();
    } else if (type === 'metadata') {
      displayMetadata(data.metadata, data.alignment, data.dtype, data.chunks, false);
      stop(false);
      setStatus('Metadata ready. Choose channels and a plane, then sample.');
    } else if (type === 'batch') {
      if (!firstBatchMs) firstBatchMs = performance.now() - runStarted;
      if (!result)
        result = {
          settings: s,
          cells: [],
          metadata: data.metadata,
          alignment: data.alignment,
          stats: { requests: 0, bytes: 0, cacheHits: 0, objects: [] },
          tiles: [],
          timings: {},
          warnings: [],
          created: new Date().toISOString(),
          model_id: 'pending',
        };
      result.cells.push(...data.cells);
      applyFilters();
    } else if (type === 'result') {
      result = data;
      result!.timings.first_batch = firstBatchMs;
      result!.timings.browser_to_result = performance.now() - runStarted;
      stop(false);
      featurePreparation = finish(result!);
    } else if (type === 'error') {
      stop();
      clearResults();
      setStatus(String(data), true);
      $('#empty').querySelector('p')!.textContent = 'No result published.';
      $('#empty').querySelector('span:last-child')!.textContent =
        'Adjust the source or settings, then try again.';
    }
  };
  worker.postMessage({
    id,
    action,
    settings: s,
    files: s.source.startsWith('local://') && localFiles ? [...localFiles] : undefined,
  });
}
$('#settings').onsubmit = (event) => {
  event.preventDefault();
  start('run');
};
button('inspect').onclick = () => start('inspect');
function clearResults() {
  selected = undefined;
  multiSelected.clear();
  $('#multi-select-bar').hidden = true;
  $('#object-details').hidden = true;
  flatImage = undefined;
  imageQueue = [];
  imageQueueIndex = 0;
  imageQueueProject = '';
  result = undefined;
  morphem.stop();
  visible = [];
  dbReady = false;
  setExports(false);
  $('#metrics').hidden = true;
  $('#warnings').hidden = true;
  $('#run-details').textContent = 'No completed run.';
  $('#result-count').textContent = 'No completed run';
  previewWorker?.terminate();
  previewWorker = undefined;
  previewLoadedFor = undefined;
  previewData = undefined;
  $<HTMLDetailsElement>('#whole-preview').hidden = true;
  $('#whole-preview-note').textContent = '';
  viewMode = 'objects';
  setViewModeAvailability(false);
  applyViewMode();
  renderGrid();
}
function setExports(enabled: boolean) {
  for (const id of ['raw', 'mosaic-png', 'manifest']) button(id).disabled = !enabled;
  for (const id of ['csv', 'parquet']) button(id).disabled = !enabled || !dbReady;
}
async function finish(run: RunResult) {
  displayMetadata(run.metadata, run.alignment);
  setViewModeAvailability(true);
  $('#metrics').hidden = false;
  $('#metrics').textContent =
    `${run.cells.length} objects · ${run.tiles.length} tiles · Z ${run.settings.z} · ${(run.stats.bytes / 1048576).toFixed(2)} MiB fetched · ${(run.timings.total / 1000).toFixed(2)} s`;
  $('#warnings').hidden = run.warnings.length === 0;
  $('#warnings').textContent = run.warnings.join(' ');
  $('#run-details').textContent = JSON.stringify(provenance(run), null, 2);
  setStatus(run.cells.length ? '' : 'No objects matched the filters.');
  applyFilters();
  setExports(true);
  previewLoadedFor = undefined;
  $<HTMLDetailsElement>('#whole-preview').hidden = false;
  if ($<HTMLDetailsElement>('#whole-preview').open) loadWholePreview();
  try {
    const { loadCells } = await import('./database');
    await loadCells(run.cells);
    if (result !== run) return;
    dbReady = true;
    setExports(true);
  } catch (e) {
    if (result !== run) return;
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
  featurizeInBackground(run);
}
/** Lazily fetches the coarsest pyramid level in a dedicated worker, kept
 * separate from the sampling worker so opening this panel never competes
 * with (or is torn down by) an in-progress or background run. */
function loadWholePreview() {
  const run = result;
  if (!run || previewLoadedFor === run) return;
  previewLoadedFor = run;
  previewWorker?.terminate();
  $('#whole-preview-note').textContent = 'Loading…';
  const id = ++previewGeneration;
  previewWorker = new Worker(new URL('./preview.worker.ts', import.meta.url), {
    type: 'module',
  });
  previewWorker.onerror = (event) => {
    if (id !== previewGeneration) return;
    $('#whole-preview-note').textContent = `Preview worker error: ${event.message}`;
  };
  previewWorker.onmessage = (event) => {
    if (event.data.id !== id) return;
    const { type, data } = event.data;
    if (type === 'preview') drawWholePreview(run, data);
    else if (type === 'unavailable') $('#whole-preview-note').textContent = String(data);
    else if (type === 'error')
      $('#whole-preview-note').textContent = `Whole-image preview failed: ${String(data)}`;
  };
  previewWorker.postMessage({ id, settings: run.settings });
}
type WholePreviewData = {
  width: number;
  height: number;
  z: number;
  t: number;
  channels: number[];
  pixels: Pixels[];
};
let previewData: WholePreviewData | undefined;
function drawWholePreview(run: RunResult, data: WholePreviewData) {
  if (result !== run) return;
  previewData = data;
  const canvas = $<HTMLCanvasElement>('#whole-preview-canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const colorsFor = data.channels.map((c) => (hiddenChannels.has(c) ? '000000' : 'FFFFFF')),
    low = Number(input('display-low').value),
    high = Number(input('display-high').value),
    limits =
      select('contrast').value === 'fixed' && high > low
        ? data.channels.map(() => [low, high] as [number, number])
        : undefined;
  const pixels = composite(data.pixels, data.width, data.height, colorsFor, limits);
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), data.width, data.height), 0, 0);
  $('#whole-preview-note').textContent =
    `${data.width} × ${data.height} px · level ${run.metadata.levels.length - 1} (coarsest pyramid level) · Z ${data.z} · time ${data.t}`;
}
$<HTMLDetailsElement>('#whole-preview').addEventListener('toggle', () => {
  if ($<HTMLDetailsElement>('#whole-preview').open) loadWholePreview();
});
/** Publish each completed crop without replacing the base measurement table. */
function featurizeInBackground(run: RunResult) {
  if (result !== run || !dbReady || !run.cells.length) return;
  worker?.terminate();
  worker = undefined;
  morphem.start(run.cells, async (cell, features) => {
    const { publishCellFeatures } = await import('./database');
    if (result !== run) return;
    await publishCellFeatures(run.cells, cell.cell_id, features);
  });
}
function applyFilters() {
  if (!result) return;
  const renderStart = performance.now();
  const area = Number(input('filter-area').value) || 0,
    mean = Number(input('filter-intensity').value) || 0;
  visible = result.cells.filter((c) => c.area >= area && (c.means[0] ?? 0) >= mean);
  const order = select('sort').value;
  if (order === 'random') visible = seededOrder(visible, result.settings.seed);
  else
    visible.sort((a, b) =>
      order === 'area-asc'
        ? a.area - b.area
        : order === 'area-desc'
          ? b.area - a.area
          : (b.means[0] ?? 0) - (a.means[0] ?? 0),
    );
  $('#result-count').textContent = `${visible.length} of ${result.cells.length} objects`;
  $('#empty').hidden = visible.length > 0;
  if (!visible.length) {
    $('#empty').querySelector('p')!.textContent = 'No objects in this view.';
    $('#empty').querySelector('span:last-child')!.textContent =
      'Adjust filters or sample another region.';
  }
  $('#mosaic-scroll').scrollTop = 0;
  renderGrid();
  result.timings.render = performance.now() - renderStart;
}
for (const id of ['sort', 'filter-area', 'filter-intensity'])
  $('#' + id).addEventListener('input', applyFilters);
for (const id of ['size', 'overlay', 'context', 'contrast', 'display-low', 'display-high'])
  $('#' + id).addEventListener('input', () => {
    renderGrid();
    if (selected) drawInspector();
  });
function colors(cell: Cell) {
  return cell.channels.map((channel) => (hiddenChannels.has(channel) ? '000000' : 'FFFFFF'));
}
function displayOptions(cell: Cell) {
  const low = Number(input('display-low').value),
    high = Number(input('display-high').value);
  return {
    context: input('context').checked,
    ...(select('contrast').value === 'fixed' && high > low
      ? { limits: cell.channels.map(() => [low, high] as [number, number]) }
      : {}),
  };
}
function renderGrid() {
  const grid = $('#mosaic'),
    scroll = $('#mosaic-scroll'),
    size = Number(input('size').value),
    step = size + 10,
    columns = Math.max(1, Math.floor((scroll.clientWidth - 16) / step)),
    rows = Math.ceil(visible.length / columns),
    first = Math.max(0, Math.floor(scroll.scrollTop / step) - 1),
    last = Math.min(rows, Math.ceil((scroll.scrollTop + scroll.clientHeight) / step) + 1);
  grid.style.height = `${rows * step}px`;
  grid.setAttribute('aria-rowcount', String(rows));
  grid.setAttribute('aria-colcount', String(columns));
  grid.replaceChildren();
  for (let row = first; row < last; row++)
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col,
        cell = visible[index];
      if (!cell) break;
      const noteCount = voiceCounts.get(associationKey(contextForCell(cell), cell.cell_id)) ?? 0;
      const tile = document.createElement('button');
      tile.className = 'object-tile';
      tile.classList.toggle('annotated', noteCount > 0);
      tile.classList.toggle('multi-selected', multiSelected.has(cell.cell_id));
      tile.dataset.id = cell.cell_id;
      tile.style.cssText = `width:${size}px;height:${size}px;top:${row * step}px;left:${col * step + 8}px`;
      tile.setAttribute('role', 'gridcell');
      tile.setAttribute(
        'aria-label',
        `Object ${cell.cell_id}, area ${cell.area} pixels${noteCount ? ', annotated' : ''}`,
      );
      tile.setAttribute('aria-rowindex', String(row + 1));
      tile.setAttribute('aria-colindex', String(col + 1));
      const canvas = document.createElement('canvas');
      drawCrop(
        canvas,
        cell,
        colors(cell),
        input('overlay').checked,
        size * 2,
        displayOptions(cell),
      );
      const caption = document.createElement('span');
      caption.textContent = `${cell.area} px²`;
      tile.append(canvas, caption);
      tile.onclick = () => openInspector(cell);
      tile.onkeydown = (event) => {
        const delta =
          event.key === 'ArrowRight'
            ? 1
            : event.key === 'ArrowLeft'
              ? -1
              : event.key === 'ArrowDown'
                ? columns
                : event.key === 'ArrowUp'
                  ? -columns
                  : 0;
        if (!delta) return;
        event.preventDefault();
        const next = Math.max(0, Math.min(visible.length - 1, index + delta)),
          nextRow = Math.floor(next / columns);
        scroll.scrollTop = Math.max(0, nextRow * step - step);
        renderGrid();
        grid
          .querySelector<HTMLButtonElement>(`button[data-id="${visible[next].cell_id}"]`)
          ?.focus({ preventScroll: true });
      };
      const multiSelectToggle = document.createElement('button');
      multiSelectToggle.type = 'button';
      multiSelectToggle.className = 'tile-select';
      multiSelectToggle.style.cssText = `top:${row * step + 4}px;left:${col * step + 4}px`;
      const isSelected = multiSelected.has(cell.cell_id);
      multiSelectToggle.classList.toggle('active', isSelected);
      multiSelectToggle.setAttribute('aria-pressed', String(isSelected));
      multiSelectToggle.setAttribute(
        'aria-label',
        `${isSelected ? 'Deselect' : 'Select'} ${cell.cell_id} for batch voice annotation`,
      );
      multiSelectToggle.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
      multiSelectToggle.onclick = (event) => {
        event.stopPropagation();
        toggleMultiSelect(cell.cell_id);
      };
      const voice = document.createElement('button');
      voice.type = 'button';
      voice.className = 'tile-voice-notes';
      voice.style.cssText = `top:${row * step + 4}px;left:${col * step + size - 26}px`;
      voice.classList.toggle('has-notes', noteCount > 0);
      voice.title = `Voice notes${noteCount ? ` · ${noteCount} saved` : ''}`;
      voice.setAttribute(
        'aria-label',
        `Voice notes for ${cell.cell_id}${noteCount ? `, ${noteCount} saved` : ''}`,
      );
      voice.setAttribute('aria-haspopup', 'dialog');
      voice.setAttribute('aria-controls', 'voice-notes-dialog');
      voice.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="5.5" y="1" width="5" height="8" rx="2.5"/><path d="M3 6.5v1a5 5 0 0 0 10 0v-1M8 12.5V15M5.5 15h5"/></svg>';
      if (noteCount) {
        const count = document.createElement('span');
        count.textContent = String(noteCount);
        voice.append(count);
      }
      voice.onclick = () => openInspector(cell);
      grid.append(tile, multiSelectToggle, voice);
    }
}
function toggleMultiSelect(cellId: string): void {
  if (multiSelected.has(cellId)) multiSelected.delete(cellId);
  else multiSelected.add(cellId);
  renderGrid();
  renderMultiSelectBar();
}
function renderMultiSelectBar(): void {
  $('#multi-select-bar').hidden = multiSelected.size === 0;
  $('#multi-select-count').textContent =
    multiSelected.size === 1 ? '1 object selected' : `${multiSelected.size} objects selected`;
}
button('multi-select-clear').onclick = () => {
  multiSelected.clear();
  renderGrid();
  renderMultiSelectBar();
};
button('multi-select-annotate').onclick = () => {
  const cells = visible.filter((cell) => multiSelected.has(cell.cell_id));
  if (cells.length) voiceNotes.open(contextForCells(cells));
};
$('#mosaic-scroll').onscroll = () => {
  cancelAnimationFrame(gridFrame);
  gridFrame = requestAnimationFrame(renderGrid);
};
new ResizeObserver(() => renderGrid()).observe($('#mosaic-scroll'));
function openInspector(cell: Cell) {
  if (!voiceNotes.open(contextForCell(cell))) return;
  selected = cell;
  $('#object-title').textContent = cell.cell_id;
  const fields = $('#object-fields');
  fields.replaceChildren();
  const entries: Record<string, string> = {
    Area: `${cell.area} px²`,
    Centroid: `x ${cell.cx.toFixed(2)}, y ${cell.cy.toFixed(2)}`,
    'Physical position': `${cell.physical_x.toFixed(3)}, ${cell.physical_y.toFixed(3)}, ${cell.physical_z.toFixed(3)} ${cell.unit}`,
    'Bounding box': `${cell.x}, ${cell.y} · ${cell.width} × ${cell.height} px`,
    'Sample region': `${cell.region_x}, ${cell.region_y} · ${cell.region_width} × ${cell.region_height} px`,
    'Native crop': `${cell.crop.width} × ${cell.crop.height} px`,
    Source: cell.source,
    'Segmentation version': cell.segmentation_version,
    Plane: `level ${cell.level}, t ${cell.t}, z ${cell.z}`,
    'Instance ID': String(cell.label),
    'Reader / segmentation': `${cell.reader} / ${cell.segmentation}`,
    Model: cell.model_id,
    Seed: cell.seed,
    'Tile edge': cell.edge ? 'Yes · potentially incomplete' : 'No',
  };
  cell.means.forEach(
    (mean, i) => (entries[`Mean · channel ${cell.channels[i]}`] = mean.toFixed(3)),
  );
  for (const [name, value] of Object.entries(entries)) {
    const dt = document.createElement('dt'),
      dd = document.createElement('dd');
    dt.textContent = name;
    dd.textContent = value;
    fields.append(dt, dd);
  }
  const link = $<HTMLAnchorElement>('#source-link');
  link.href = 'https://ome.github.io/ome-ngff-validator/?source=' + encodeURIComponent(cell.source);
  $('#object-details').hidden = false;
  drawInspector();
}
function drawInspector() {
  if (!selected || !result) return;
  drawCrop(
    $<HTMLCanvasElement>('#inspector-canvas'),
    selected,
    colors(selected),
    true,
    600,
    displayOptions(selected),
  );
  const canvas = $<HTMLCanvasElement>('#origin'),
    ctx = canvas.getContext('2d')!,
    a = result.alignment,
    w = a.shape[a.axes.indexOf('x')],
    h = a.shape[a.axes.indexOf('y')],
    scale = Math.min((canvas.width - 20) / w, (canvas.height - 20) / h);
  ctx.fillStyle = '#101b20';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#56656a';
  ctx.strokeRect(10, 10, w * scale, h * scale);
  for (const tile of result.tiles) {
    ctx.fillStyle = '#31464b';
    ctx.fillRect(10 + tile.x * scale, 10 + tile.y * scale, tile.width * scale, tile.height * scale);
  }
  ctx.strokeStyle = '#f1d987';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    10 + selected.x * scale,
    10 + selected.y * scale,
    Math.max(3, selected.width * scale),
    Math.max(3, selected.height * scale),
  );
}
button('inspector-morphem').onclick = () =>
  perform(async () => {
    if (!selected) return;
    const cell = selected;
    const buttonElement = button('inspector-morphem');
    buttonElement.disabled = true;
    buttonElement.textContent = 'Embedding…';
    try {
      const snapshot = result;
      await featurePreparation; // crops can be inspected before the export table finishes loading
      if (snapshot !== result || selected !== cell) return;
      const features = await morphem.waitFor(cell.cell_id);
      if (snapshot !== result || selected !== cell) return;
      // Display the first four values of each channel embedding plus summary
      // stats in the object fields; the full vectors are downloadable as JSON.
      const first = features.embeddings[0]!;
      const manifest = {
        cell_id: cell.cell_id,
        model: features.modelId,
        model_revision: features.modelRevision,
        preprocessing: MORPHEM_PREPROCESSING,
        channels: cell.channels,
        feature_names: features.featureNames,
        embeddings: features.embeddings.map((e) => Array.from(e, (v) => Number(v.toFixed(6)))),
        crop_width: features.cropWidth,
        crop_height: features.cropHeight,
        milliseconds: Math.round(features.ms),
      };
      download(
        new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
        `morphem-${cell.cell_id}.json`,
      );
      setStatus(
        `MorphEm: ${features.embeddings.length} channel embedding${features.embeddings.length === 1 ? '' : 's'} × ${first.length} dims in ${Math.round(features.ms)} ms; JSON downloaded. First values: ${Array.from(first.slice(0, 4), (v) => v.toFixed(3)).join(', ')}…`,
      );
    } finally {
      buttonElement.disabled = false;
      buttonElement.textContent = 'MorphEm features';
    }
  });
async function perform(action: () => Promise<void>) {
  try {
    await action();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}
for (const format of ['csv', 'parquet'] as const)
  button(format).onclick = () =>
    perform(async () => {
      const snapshot = result;
      const query = `SELECT * FROM cells WHERE cell_id IN (${visible.length ? visible.map((c) => `'${c.cell_id.replaceAll("'", "''")}'`).join(',') : "'__no_objects__'"})`;
      const { exportTable } = await import('./database');
      const bytes = await exportTable(query, format, true);
      if (result !== snapshot) return;
      download(bytes, `cytorecorder.${format}`);
    });
button('manifest').onclick = () => {
  if (result)
    download(
      new TextEncoder().encode(
        JSON.stringify(
          {
            ...provenance(result),
            view: readView(),
            visible_cell_ids: visible.map((c) => c.cell_id),
          },
          null,
          2,
        ),
      ),
      'cytorecorder-run.json',
      'application/json',
    );
};
button('raw').onclick = () =>
  perform(async () => {
    if (!result) return;
    const snapshot = result,
      cells = [...visible];
    button('raw').disabled = true;
    setStatus('Preparing native crop archive…');
    try {
      const bytes = await cropArchive(snapshot, cells);
      if (result !== snapshot) return;
      download(bytes, 'cytorecorder-crops.zip', 'application/zip');
      setStatus('Native crop archive exported with per-object metadata and original dtypes.');
    } finally {
      if (result === snapshot) button('raw').disabled = false;
    }
  });
function saveCanvas(canvas: HTMLCanvasElement, name: string): Promise<void> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(Error('PNG encoding failed'));
        return;
      }
      download(blob, name);
      resolve();
    }, 'image/png'),
  );
}
button('crop-png').onclick = () =>
  perform(async () => {
    if (selected)
      await saveCanvas(
        $<HTMLCanvasElement>('#inspector-canvas'),
        selected.cell_id + '-preview.png',
      );
  });
button('mosaic-png').onclick = () =>
  perform(async () => {
    if (!visible.length) throw Error('No visible objects to export');
    const size = 96,
      cols = Math.min(16, Math.ceil(Math.sqrt(visible.length))),
      canvas = document.createElement('canvas');
    canvas.width = cols * size;
    canvas.height = Math.ceil(visible.length / cols) * size;
    const ctx = canvas.getContext('2d')!;
    visible.forEach((cell, i) => {
      const tile = document.createElement('canvas');
      drawCrop(tile, cell, colors(cell), input('overlay').checked, size, displayOptions(cell));
      ctx.drawImage(tile, (i % cols) * size, Math.floor(i / cols) * size);
    });
    await saveCanvas(canvas, 'cytorecorder-mosaic-preview.png');
  });

if (initialSettingsValid) {
  const params = new URL(location.href).searchParams,
    projectHint = params.get('project'),
    voiceEnabledOnLoad = params.get('voice') === '1';
  if (projectHint) qualityPanel.prefillProject(projectHint);
  // A project hint means this tab was opened by the cytorecorder CLI for a
  // dedicated whole-image QC review session, not the public demo: skip the
  // automatic BIA fetch and per-object voice notes (objects mode) by
  // default, and just wait for the person to drag their own folder in.
  // `?voice=1` (cytorecorder review --enable_voice_notes) opts back into
  // today's default demo behavior even with a project hint present.
  const suppressAutoDemo = Boolean(projectHint) && !voiceEnabledOnLoad;
  if (suppressAutoDemo) {
    setStatus(
      `Drag the image folder for "${projectHint}" onto the mosaic, or use Upload folder, to begin reviewing.`,
    );
  } else if (!params.has('source') && !params.has('reference')) {
    void pullNewImage(false);
  } else {
    start('run');
    const source = settings.source;
    archiveDiscovery.remember(source);
    if (archiveImageId(source) && !datasetForSource(source)) {
      void describeArchiveSource(source, AbortSignal.timeout(15000))
        .then((sample) => {
          if (!sample || settings.source !== source) return;
          registerDataset(sample);
          renderBiology(source);
          if (result) displayMetadata(result.metadata, result.alignment);
        })
        .catch(() => {
          /* Keep explicit unknown provenance if the API is unavailable. */
        });
    }
  }
}
