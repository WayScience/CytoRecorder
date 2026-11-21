"""
Tests for URL construction and the review() validation/instructions flow.
No server is involved — review() never blocks, so it is tested directly.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from cytorecorder.main import build_app_url, review


def test_build_app_url_carries_only_the_project_name() -> None:
    url = build_app_url("https://example.org/app/", "Bandicoot")
    assert url == "https://example.org/app/?project=Bandicoot"


def test_build_app_url_with_no_project_returns_the_bare_app_url() -> None:
    assert build_app_url("https://example.org/app/", "") == "https://example.org/app/"


def test_review_defaults_the_project_name_to_the_input_folder_name(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "my-plate"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    url = review(str(input_dir), str(tmp_path / "out"), open_browser=False)
    assert "project=my-plate" in url


def test_review_respects_an_explicit_project_override(tmp_path: Path) -> None:
    input_dir = tmp_path / "my-plate"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    url = review(
        str(input_dir), str(tmp_path / "out"), project="Override", open_browser=False
    )
    assert "project=Override" in url
    assert "my-plate" not in url


def test_review_raises_clearly_when_no_images_are_found(tmp_path: Path) -> None:
    input_dir = tmp_path / "empty"
    input_dir.mkdir()
    with pytest.raises(FileNotFoundError):
        review(str(input_dir), str(tmp_path / "out"), open_browser=False)


def test_review_never_opens_a_browser_when_told_not_to(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    opened: list[str] = []
    monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))
    review(str(input_dir), str(tmp_path / "out"), open_browser=False)
    assert opened == []


def test_review_refuses_to_proceed_when_output_already_has_a_non_empty_csv(
    tmp_path: Path,
) -> None:
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    output_dir = tmp_path / "out"
    output_dir.mkdir()
    (output_dir / "quality_labels.csv").write_text("image_path,project\na.png,p\n")
    with pytest.raises(FileExistsError, match="already has content"):
        review(str(input_dir), str(output_dir), open_browser=False)


def test_review_proceeds_over_an_existing_csv_when_force_is_set(tmp_path: Path) -> None:
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    output_dir = tmp_path / "out"
    output_dir.mkdir()
    (output_dir / "quality_labels.csv").write_text("image_path,project\na.png,p\n")
    url = review(str(input_dir), str(output_dir), open_browser=False, force=True)
    assert "project=images" in url


def test_review_ignores_an_existing_but_empty_csv_without_force(tmp_path: Path) -> None:
    input_dir = tmp_path / "images"
    input_dir.mkdir()
    (input_dir / "a.png").write_bytes(b"x")
    output_dir = tmp_path / "out"
    output_dir.mkdir()
    (output_dir / "quality_labels.csv").touch()  # zero bytes: nothing real to lose
    url = review(str(input_dir), str(output_dir), open_browser=False)
    assert "project=images" in url
