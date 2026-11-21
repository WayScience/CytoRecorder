/** Whole-image QC label (issue: "Add whole-image quality annotation workflow").
 * One record per (imagePath, annotator) — the composite `id` — so independent
 * annotators labeling the same image never clobber each other, while the same
 * annotator reopening the same image resumes/overwrites only their own label. */
export interface QualityLabel {
  id: string;
  schemaVersion: 1;
  imagePath: string;
  project: string;
  annotator: string;
  qualityLabel: string;
  createdAt: string;
  updatedAt: string;
}
