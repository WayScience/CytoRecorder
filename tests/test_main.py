"""
Tests for serve-URL construction and server preparation (not serve_forever
itself — that blocks; its request handling is covered in test_server.py).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from cytorecorder_local.main import build_app_url, prepare


def test_build_app_url_carries_manifest_export_and_project_as_query_params() -> None:
    url = build_app_url("https://example.org/app/", 8765, "Bandicoot")
    assert url.startswith("https://example.org/app/?")
    assert "manifest=http%3A%2F%2F127.0.0.1%3A8765%2Fmanifest.json" in url
    assert "export=http%3A%2F%2F127.0.0.1%3A8765%2Fexport" in url
    assert "project=Bandicoot" in url


def test_prepare_defaults_the_project_name_to_the_input_folder_name(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "my-plate"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    server, url, image_count = prepare(str(input_dir), str(tmp_path / "out"), port=0)
    # server_close, not shutdown(): shutdown() blocks forever waiting for a
    # serve_forever() loop that was never started in this prepare-only test.
    server.server_close()
    assert image_count == 1
    assert "project=my-plate" in url


def test_prepare_raises_before_binding_a_socket_when_no_images_are_found(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "empty"
    input_dir.mkdir()
    with pytest.raises(FileNotFoundError):
        prepare(str(input_dir), str(tmp_path / "out"), port=0)
