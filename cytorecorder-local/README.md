# cytorecorder-local

Local companion CLI for [CytoRecorder](https://wayscience.github.io/CytoRecorder/): confirms a folder of whole microscopy images exists (recursively, including subdirectories) and opens the hosted CytoRecorder app so a human can complete a whole-image quality review and export the results themselves.

This CLI does not run a server and does not push data into the browser. A human still drags the input folder into CytoRecorder (or uses its "Upload folder" button) and, when finished, saves the exported `quality_labels.csv` into the output folder themselves. Browsers cannot be made to silently read or write arbitrary local paths, so this stays a manual, two-step handoff by design.

## Install

```sh
pip install cytorecorder-local
```

## Use

```sh
cytorecorder-local review --input_dir=/path/to/images --output_dir=/path/to/results
```

This:

1. Scans `input_dir` recursively for `.png`/`.tif`/`.tiff` files and fails fast if none are found.
1. Refuses (unless `--force=True`) if `output_dir/quality_labels.csv` already exists and is non-empty, so a review run can't silently clobber a previous export.
1. Opens the hosted CytoRecorder app at a URL carrying a project name (defaulting to `input_dir`'s own folder name).
1. Prints the remaining manual steps: drag `input_dir` into the app, switch to Single image mode, label each image, then export the CSV into `output_dir`.

Run `cytorecorder-local review --help` for all options (`--project`, `--app_url`, `--open_browser`, `--force`).

## Develop

```sh
uv sync
uv run --frozen pytest
uv run pre-commit run --all-files
```
