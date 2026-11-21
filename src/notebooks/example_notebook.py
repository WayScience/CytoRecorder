# ---
# jupyter:
#   jupytext:
#     text_representation:
#       extension: .py
#       format_name: light
#       format_version: '1.5'
#       jupytext_version: 1.17.1
#   kernelspec:
#     display_name: Python 3 (ipykernel)
#     language: python
#     name: python3
# ---

# # An example notebook
#
# Sharing how a notebook can work in combination with a Python package.
#
# Notes:
# - [`jupytext`](https://github.com/mwouts/jupytext) helps us automatically
# export the notebook through `pyproject.toml` configuration.
# This makes it easier to provide line-level comments within pull
# request reviews or to use the Python file independent of the notebook.
# - [`jupyterlab_code_formatter`](https://github.com/jupyterlab-contrib/jupyterlab_code_formatter)
# helps automatically format the notebook on-the-fly using black, isort, and
# more so that our notebook has a consistent and readable format
# (including as we develop it!). This extension is available through the
# browser-based Juypyter interface
# as a circular button near the top of each notebook.
# Clicking it applies the formatting to the notebook.

# show an import from a local package
from pathlib import Path
from tempfile import TemporaryDirectory

from cytorecorder_local import prepare

# build a small sample image folder and show how `prepare` discovers it
with TemporaryDirectory() as tmp:
    input_dir = Path(tmp) / "images"
    (input_dir / "plate1").mkdir(parents=True)
    (input_dir / "plate1" / "well_a1.png").write_bytes(
        b"not a real png, for discovery only"
    )
    server, url, image_count = prepare(
        str(input_dir), str(Path(tmp) / "output"), port=0
    )
    server.shutdown()
    print(f"Discovered {image_count} image(s); CytoRecorder URL: {url}")
