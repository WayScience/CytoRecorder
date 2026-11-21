"""
Helps a human complete a CytoRecorder whole-image QC review run: discovers
the images under a local folder (recursively) and opens the hosted
GitHub Pages app so a person can drag that folder in, review and label the
images there, and export the resulting CSV into the output folder
themselves. No local HTTP server, no network upload of the images — the
images never leave the machine except through the browser's own existing
local-folder upload, which already runs entirely client-side.
"""

from __future__ import annotations

import webbrowser
from pathlib import Path
from urllib.parse import urlencode

from cytorecorder_local.images import discover_images

DEFAULT_APP_URL = "https://wayscience.github.io/musivarium/"


def build_app_url(app_url: str, project: str) -> str:
    """
    Builds the CytoRecorder URL to open, carrying only the project name
    (prefilled into the whole-image QC panel's Project field) — there is no
    server behind this URL to fetch images from or export to.

    Args:
        app_url (str):
            Base URL of the hosted CytoRecorder app.
        project (str):
            Project name to prefill in the browser.

    Returns:
        str:
            The full CytoRecorder URL to open.
    """

    if not project:
        return app_url
    return f"{app_url.rstrip('/')}/?{urlencode({'project': project})}"


def review(  # noqa: PLR0913 (CLI config surface: one kwarg per launch option)
    input_dir: str,
    output_dir: str,
    project: str = "",
    app_url: str = DEFAULT_APP_URL,
    open_browser: bool = True,
    force: bool = False,
) -> str:
    """
    Validates the input folder, prints the steps a human takes to complete
    the review in the browser, and (by default) opens CytoRecorder.

    Args:
        input_dir (str):
            Folder of whole images to review; scanned recursively for
            ``.png``/``.tif``/``.tiff`` files to confirm there is something
            to review before opening a browser tab.
        output_dir (str):
            Folder the human should save the exported quality_labels.csv
            into, from the browser's "Export quality labels (CSV)" button.
        project (str):
            Project name; defaults to the input folder's own name.
        app_url (str):
            Base URL of the hosted CytoRecorder app to open.
        open_browser (bool):
            Whether to open the system browser automatically.
        force (bool):
            Proceed even if output_dir already has a non-empty
            quality_labels.csv (which the browser export would overwrite).
            Defaults to False: refuse and raise instead.

    Returns:
        str:
            The CytoRecorder URL that was (or would be) opened.
    """

    image_count = len(discover_images(input_dir))
    if image_count == 0:
        raise FileNotFoundError(
            f"No PNG/TIFF images found under {input_dir} (recursively)."
        )
    project_name = project or Path(input_dir).name
    output_path = Path(output_dir) / "quality_labels.csv"
    if output_path.exists() and output_path.stat().st_size > 0 and not force:
        raise FileExistsError(
            f"{output_path} already has content and would be overwritten by a new "
            "export. Pass force=True to proceed anyway, move/rename the existing "
            "file first, or choose a different output_dir."
        )
    url = build_app_url(app_url, project_name)
    # flush=True: stdout is fully buffered (not line-buffered) once it is a
    # pipe rather than a terminal, so a caller reading these lines live
    # (e.g. this package's own CLI tests) would otherwise block waiting on
    # data still sitting in this process's buffer.
    print(f"Found {image_count} image(s) under {input_dir} (recursively).", flush=True)
    if output_path.exists() and output_path.stat().st_size > 0:
        print(
            f"Warning: {output_path} already has content and will be overwritten.",
            flush=True,
        )
    print(f"1. Open: {url}", flush=True)
    print(
        f"2. In CytoRecorder, drag the folder {input_dir} onto the mosaic", flush=True
    )
    print(
        "   (or use its Upload folder button) and switch to Single image mode.",
        flush=True,
    )
    print(
        "3. Review and label each image with the whole-image quality buttons.",
        flush=True,
    )
    print(
        f"4. Click 'Export quality labels (CSV)' and save it to {output_path}.",
        flush=True,
    )
    if open_browser:
        webbrowser.open(url)
    return url
