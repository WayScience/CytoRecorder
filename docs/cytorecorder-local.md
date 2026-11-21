# cytorecorder-local

A local companion CLI (in [`cytorecorder-local/`](../cytorecorder-local)) for the whole-image quality review workflow: confirms a folder of microscopy images exists on disk (recursively) and opens this hosted app so a human can review and label them in Single image mode, then export `quality_labels.csv` back to a local folder.

It intentionally does not run a server or push files into the browser — a human still drags the folder in (or uses the app's "Upload folder" button) and saves the export themselves. Install with `pip install cytorecorder-local`; see [`cytorecorder-local/README.md`](../cytorecorder-local/README.md) for CLI usage and [`cytorecorder-local/src/cytorecorder_local/main.py`](../cytorecorder-local/src/cytorecorder_local/main.py) for the implementation.
