"""
Tests for the cli module.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def test_serve_cli_surfaces_a_clear_error_for_an_image_free_input_dir(
    tmp_path: Path,
) -> None:
    """
    Exercises the real Fire-wired `serve` command (input_dir/output_dir/
    open_browser kwargs) end to end as a subprocess, without actually
    binding a server or blocking on serve_forever().
    """

    empty_input = tmp_path / "empty"
    empty_input.mkdir()
    output = subprocess.run(
        [
            "uv",
            "run",
            "cytorecorder-local",
            "serve",
            f"--input_dir={empty_input}",
            f"--output_dir={tmp_path / 'out'}",
            "--open_browser=False",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert output.returncode != 0
    assert "No PNG/TIFF images found" in (output.stdout + output.stderr)


def test_serve_cli_discovers_real_images_and_reports_the_url_to_open(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    process = subprocess.Popen(
        [
            "uv",
            "run",
            "cytorecorder-local",
            "serve",
            f"--input_dir={input_dir}",
            f"--output_dir={tmp_path / 'out'}",
            "--port=0",
            "--open_browser=False",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        assert process.stdout is not None  # requested via stdout=PIPE above
        lines = []
        for _ in range(3):
            line = process.stdout.readline()
            if not line:
                break
            lines.append(line)
        combined = "".join(lines)
        assert "Serving 1 image(s)" in combined
        assert "Open: https://wayscience.github.io/musivarium/?" in combined
    finally:
        process.terminate()
        process.wait(timeout=5)
