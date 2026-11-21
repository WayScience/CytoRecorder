"""
Discover whole microscopy images under an input directory, recursively.
"""

from __future__ import annotations

from pathlib import Path

IMAGE_SUFFIXES = (".png", ".tif", ".tiff")


def discover_images(input_dir: Path | str) -> list[Path]:
    """
    Recursively find PNG/TIFF whole images under ``input_dir``, including
    subdirectories, matching how a user dragging the same folder onto
    CytoRecorder's browser upload would see it.

    Args:
        input_dir (Path | str):
            Root folder to scan.

    Returns:
        list[Path]:
            Image paths relative to ``input_dir``, sorted deterministically.
    """

    root = Path(input_dir)
    if not root.is_dir():
        raise NotADirectoryError(f"Input directory does not exist: {root}")
    found = [
        path.relative_to(root)
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    ]
    return sorted(found)
