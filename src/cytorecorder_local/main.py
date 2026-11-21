"""
Launches the local server and builds the CytoRecorder URL that points the
browser app at it — "sending the browser config details like input and
output folders" from the issue, since a URL cannot grant filesystem access
but can carry where to fetch images from and where to POST exports to.
"""

from __future__ import annotations

import webbrowser
from pathlib import Path
from urllib.parse import urlencode

from cytorecorder_local.images import discover_images
from cytorecorder_local.server import ThreadingHTTPServer, build_server

DEFAULT_APP_URL = "https://wayscience.github.io/musivarium/"
DEFAULT_CATEGORIES = ("Good", "Out-of-focus", "Debris")


def build_app_url(app_url: str, port: int, project: str) -> str:
    """
    Builds the CytoRecorder URL that drives this run: `manifest` points the
    browser at the recursively discovered image list, `export` is where its
    "Export quality labels (CSV)" button also POSTs so the table lands on
    disk under the configured output folder, not only as a browser download.

    Args:
        app_url (str):
            Base URL of the hosted (or locally served) CytoRecorder app.
        port (int):
            Port this local server is bound to.
        project (str):
            Project name shown in the browser and recorded on every label.

    Returns:
        str:
            The full CytoRecorder URL to open.
    """

    base = f"http://127.0.0.1:{port}"
    query = urlencode(
        {
            "manifest": f"{base}/manifest.json",
            "export": f"{base}/export",
            "project": project,
        }
    )
    return f"{app_url.rstrip('/')}/?{query}"


def prepare(  # noqa: PLR0913 (CLI config surface: one kwarg per launch option)
    input_dir: str,
    output_dir: str,
    project: str = "",
    port: int = 8765,
    categories: str = ",".join(DEFAULT_CATEGORIES),
    app_url: str = DEFAULT_APP_URL,
) -> tuple[ThreadingHTTPServer, str, int]:
    """
    Builds (but does not run) the local server and the URL to open.

    Args:
        input_dir (str):
            Folder of whole images to review; scanned recursively for
            ``.png``/``.tif``/``.tiff`` files.
        output_dir (str):
            Folder the exported ``quality_labels.csv`` is written into.
        project (str):
            Project name; defaults to the input folder's own name.
        port (int):
            Local port to bind.
        categories (str):
            Comma-separated QC categories offered in the browser.
        app_url (str):
            Base URL of the CytoRecorder app to point at this server.

    Returns:
        tuple[ThreadingHTTPServer, str, int]:
            The constructed (not yet started) server, the URL to open, and
            the number of images discovered.
    """

    category_list = [c.strip() for c in categories.split(",") if c.strip()]
    project_name = project or Path(input_dir).name
    image_count = len(discover_images(input_dir))
    server = build_server(
        Path(input_dir), Path(output_dir), project_name, category_list, port
    )
    url = build_app_url(app_url, port, project_name)
    return server, url, image_count


def serve(  # noqa: PLR0913 (CLI config surface: one kwarg per launch option)
    input_dir: str,
    output_dir: str,
    project: str = "",
    port: int = 8765,
    categories: str = ",".join(DEFAULT_CATEGORIES),
    app_url: str = DEFAULT_APP_URL,
    open_browser: bool = True,
) -> None:
    """
    Starts the local server and, by default, opens CytoRecorder pointed at
    it. Blocks (serving requests) until interrupted with Ctrl+C.

    Args:
        input_dir (str):
            Folder of whole images to review, scanned recursively.
        output_dir (str):
            Folder the exported ``quality_labels.csv`` is written into.
        project (str):
            Project name; defaults to the input folder's own name.
        port (int):
            Local port to bind.
        categories (str):
            Comma-separated QC categories offered in the browser.
        app_url (str):
            Base URL of the CytoRecorder app to point at this server.
        open_browser (bool):
            Whether to open the system browser automatically.
    """

    server, url, image_count = prepare(
        input_dir, output_dir, project, port, categories, app_url
    )
    output_path = Path(output_dir) / "quality_labels.csv"
    # flush=True: stdout is fully buffered (not line-buffered) once it is a
    # pipe rather than a terminal, so a caller reading these lines live
    # (e.g. a wrapper script, or this package's own CLI tests) would
    # otherwise block waiting on data still sitting in this process's buffer.
    print(f"Serving {image_count} image(s) from {input_dir}", flush=True)
    print(f"Quality labels will be written to {output_path}", flush=True)
    print(f"Open: {url}", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
