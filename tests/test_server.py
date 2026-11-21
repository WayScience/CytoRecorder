"""
Tests for the local HTTP server: manifest, image bytes, export, and the
CORS/path-safety details the browser integration depends on.
"""

from __future__ import annotations

import http
import json
import threading
from collections.abc import Iterator
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from cytorecorder_local.server import EXPORT_FILENAME, build_server


@pytest.fixture
def running_server(tmp_path: Path) -> Iterator[tuple[ThreadingHTTPServer, Path, Path]]:
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    (input_dir / "sub").mkdir(parents=True)
    (input_dir / "a.png").write_bytes(b"\x89PNGfakebytes")
    (input_dir / "sub" / "b.tiff").write_bytes(b"IItifffakebytes")
    server = build_server(
        input_dir, output_dir, "demo-project", ["Good", "Debris"], port=0
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, input_dir, output_dir
    finally:
        server.shutdown()
        thread.join(timeout=5)


def base_url(server: ThreadingHTTPServer) -> str:
    return f"http://127.0.0.1:{server.server_address[1]}"


def test_manifest_lists_every_image_recursively_with_project_and_categories(
    running_server: tuple[ThreadingHTTPServer, Path, Path],
) -> None:
    server, _, _ = running_server
    with urlopen(f"{base_url(server)}/manifest.json") as response:
        manifest = json.loads(response.read())
        assert response.headers["Access-Control-Allow-Origin"] == "*"
    assert manifest["project"] == "demo-project"
    assert manifest["categories"] == ["Good", "Debris"]
    assert {image["path"] for image in manifest["images"]} == {"a.png", "sub/b.tiff"}
    assert {image["url"] for image in manifest["images"]} == {
        "/images/a.png",
        "/images/sub/b.tiff",
    }


def test_images_endpoint_serves_the_exact_original_bytes_with_a_real_mimetype(
    running_server: tuple[ThreadingHTTPServer, Path, Path],
) -> None:
    server, input_dir, _ = running_server
    with urlopen(f"{base_url(server)}/images/a.png") as response:
        assert response.read() == (input_dir / "a.png").read_bytes()
        assert response.headers["Content-Type"] == "image/png"
    with urlopen(f"{base_url(server)}/images/sub/b.tiff") as response:
        assert response.read() == (input_dir / "sub" / "b.tiff").read_bytes()


def test_images_endpoint_rejects_path_traversal_outside_the_input_dir(
    running_server: tuple[ThreadingHTTPServer, Path, Path],
) -> None:
    server, _, _ = running_server
    with pytest.raises(HTTPError) as excinfo:
        urlopen(f"{base_url(server)}/images/../../etc/passwd")
    assert excinfo.value.code == http.HTTPStatus.FORBIDDEN


def test_images_endpoint_404s_a_missing_file(
    running_server: tuple[ThreadingHTTPServer, Path, Path],
) -> None:
    server, _, _ = running_server
    with pytest.raises(HTTPError) as excinfo:
        urlopen(f"{base_url(server)}/images/missing.png")
    assert excinfo.value.code == http.HTTPStatus.NOT_FOUND


def test_export_writes_the_posted_csv_body_verbatim_to_the_output_dir(
    running_server: tuple[ThreadingHTTPServer, Path, Path],
) -> None:
    server, _, output_dir = running_server
    csv_body = (
        "image_path,project,annotator,quality_label,created_at,updated_at\r\n"
        "a.png,p,Alice,Good,t,t\r\n"
    )
    request = Request(
        f"{base_url(server)}/export",
        data=csv_body.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/csv"},
    )
    with urlopen(request) as response:
        result = json.loads(response.read())
    written = output_dir / EXPORT_FILENAME
    assert Path(result["written"]) == written
    # read_bytes, not read_text: text mode would translate \r\n -> \n and mask
    # whether the server actually wrote the POST body byte-for-byte.
    assert written.read_bytes().decode("utf-8") == csv_body


def test_build_server_fails_clearly_when_no_images_exist(tmp_path: Path) -> None:
    empty_input = tmp_path / "empty"
    empty_input.mkdir()
    with pytest.raises(FileNotFoundError, match="No PNG/TIFF images"):
        build_server(empty_input, tmp_path / "out", "p", ["Good"], port=0)
