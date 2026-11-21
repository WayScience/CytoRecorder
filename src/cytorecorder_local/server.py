"""
A minimal local HTTP server that lets CytoRecorder's browser app read a real
local folder of whole images and write exported quality labels back to disk,
without any browser extension or native file-system permission dance:

- GET  /manifest.json  -> {project, categories, images: [{path, url}, ...]}
- GET  /images/<path>  -> raw image bytes (CORS-enabled, path-traversal safe)
- POST /export         -> overwrites <output_dir>/quality_labels.csv with the
                           request body (the browser already holds the full,
                           deduplicated table; this just persists it to disk)
"""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from cytorecorder_local.images import discover_images

EXPORT_FILENAME = "quality_labels.csv"


def _mimetype(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def make_handler(  # noqa: C901 (one small stdlib request handler; splitting
    # it up would scatter the request/response pairing this file documents)
    input_dir: Path,
    output_dir: Path,
    project: str,
    categories: list[str],
) -> type[BaseHTTPRequestHandler]:
    """
    Builds a request handler bound to one (input_dir, output_dir, project,
    categories) configuration, so the stdlib server can be constructed with
    the usual ``(handler_class, address)`` signature.
    """

    resolved_input = input_dir.resolve()

    class Handler(BaseHTTPRequestHandler):
        # Quiet by default: pytest/CI output does not need a request log line
        # per asset; errors still raise and are visible via the HTTP status.
        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            del format, args  # unused, but required to match the base signature

        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self) -> None:
            if self.path == "/manifest.json":
                self._send_manifest()
            elif self.path.startswith("/images/"):
                self._send_image(self.path[len("/images/") :])
            else:
                self._send_error(404, "Not found")

        def do_POST(self) -> None:
            if self.path == "/export":
                self._receive_export()
            else:
                self._send_error(404, "Not found")

        def _send_manifest(self) -> None:
            images = discover_images(resolved_input)
            body = json.dumps(
                {
                    "project": project,
                    "categories": categories,
                    "images": [
                        {"path": rel.as_posix(), "url": f"/images/{rel.as_posix()}"}
                        for rel in images
                    ],
                }
            ).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_image(self, relative: str) -> None:
            # unquote first: a traversal attempt arrives percent-encoded.
            candidate = (resolved_input / unquote(relative)).resolve()
            if resolved_input not in candidate.parents and candidate != resolved_input:
                self._send_error(403, "Outside the served input directory")
                return
            if not candidate.is_file():
                self._send_error(404, "No such image")
                return
            body = candidate.read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", _mimetype(candidate))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _receive_export(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / EXPORT_FILENAME).write_bytes(body)
            response = json.dumps(
                {"written": str(output_dir / EXPORT_FILENAME)}
            ).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def _send_error(self, status: int, message: str) -> None:
            body = json.dumps({"error": message}).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def build_server(
    input_dir: Path,
    output_dir: Path,
    project: str,
    categories: list[str],
    port: int,
) -> ThreadingHTTPServer:
    """
    Constructs (but does not start) the local server. Raised exceptions
    (e.g. no images under ``input_dir``) surface before anything binds a
    socket or opens a browser tab.
    """

    if not discover_images(input_dir):
        raise FileNotFoundError(
            f"No PNG/TIFF images found under {input_dir} (recursively)."
        )
    handler = make_handler(Path(input_dir), Path(output_dir), project, categories)
    return ThreadingHTTPServer(("127.0.0.1", port), handler)
