"""
Tests for image discovery.
"""

from pathlib import Path

import pytest

from cytorecorder_local.images import discover_images


@pytest.fixture
def image_tree(tmp_path: Path) -> Path:
    (tmp_path / "sub").mkdir()
    (tmp_path / "a.png").write_bytes(b"not a real png, discovery is by extension only")
    (tmp_path / "sub" / "b.tiff").write_bytes(b"not a real tiff either")
    (tmp_path / "notes.txt").write_bytes(b"ignored, not an image")
    return tmp_path


def test_discover_images_finds_png_and_tiff_recursively(image_tree: Path) -> None:
    found = discover_images(image_tree)
    assert found == [Path("a.png"), Path("sub/b.tiff")]


def test_discover_images_ignores_non_image_files(image_tree: Path) -> None:
    found = discover_images(image_tree)
    assert Path("notes.txt") not in found


def test_discover_images_is_case_insensitive_on_extension(tmp_path: Path) -> None:
    (tmp_path / "upper.PNG").write_bytes(b"x")
    (tmp_path / "mixed.Tif").write_bytes(b"x")
    found = discover_images(tmp_path)
    assert found == [Path("mixed.Tif"), Path("upper.PNG")]


def test_discover_images_raises_clearly_for_a_missing_directory(tmp_path: Path) -> None:
    with pytest.raises(NotADirectoryError, match="does not exist"):
        discover_images(tmp_path / "missing")


def test_discover_images_empty_directory_returns_empty_list(tmp_path: Path) -> None:
    assert discover_images(tmp_path) == []
