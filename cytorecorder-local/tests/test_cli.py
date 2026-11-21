"""
Tests for the cli module. `review` never blocks (no server), so a plain
subprocess.run with a real timeout is enough — no Popen/readline tricks.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def test_review_cli_surfaces_a_clear_error_for_an_image_free_input_dir(
    tmp_path: Path,
) -> None:
    empty_input = tmp_path / "empty"
    empty_input.mkdir()
    output = subprocess.run(
        [
            "uv",
            "run",
            "cytorecorder-local",
            "review",
            f"--input_dir={empty_input}",
            f"--output_dir={tmp_path / 'out'}",
            "--open_browser=False",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert output.returncode != 0
    assert "No PNG/TIFF images found" in (output.stdout + output.stderr)


def test_review_cli_discovers_real_images_and_prints_the_steps_to_open(
    tmp_path: Path,
) -> None:
    """
    Exercises the real Fire-wired `review` command end to end as a
    subprocess, confirming it reports the image count and app URL and
    exits cleanly on its own (nothing left running, no server to kill).
    """

    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    output = subprocess.run(
        [
            "uv",
            "run",
            "cytorecorder-local",
            "review",
            f"--input_dir={input_dir}",
            f"--output_dir={tmp_path / 'out'}",
            "--open_browser=False",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    combined = output.stdout + output.stderr
    assert "Found 1 image(s)" in combined
    assert "Open: https://wayscience.github.io/CytoRecorder/?project=images" in combined
    assert str(tmp_path / "out" / "quality_labels.csv") in combined


def test_review_cli_refuses_and_can_be_forced_past_an_existing_csv(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    output_dir = tmp_path / "out"
    output_dir.mkdir()
    (output_dir / "quality_labels.csv").write_text("image_path,project\na.png,p\n")

    refused = subprocess.run(
        [
            "uv",
            "run",
            "cytorecorder-local",
            "review",
            f"--input_dir={input_dir}",
            f"--output_dir={output_dir}",
            "--open_browser=False",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert refused.returncode != 0
    assert "already has content" in (refused.stdout + refused.stderr)

    forced = subprocess.run(
        [
            "uv",
            "run",
            "cytorecorder-local",
            "review",
            f"--input_dir={input_dir}",
            f"--output_dir={output_dir}",
            "--open_browser=False",
            "--force=True",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    assert "Warning:" in (forced.stdout + forced.stderr)
    assert "will be overwritten" in (forced.stdout + forced.stderr)
