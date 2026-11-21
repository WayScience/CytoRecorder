"""
CLI for cytorecorder_local
"""

import fire

from cytorecorder_local.main import DEFAULT_APP_URL, DEFAULT_CATEGORIES, serve


class cytorecorder_localCLI:
    def serve(  # noqa: PLR0913 (CLI config surface: one kwarg per launch option)
        self,
        input_dir: str,
        output_dir: str,
        project: str = "",
        port: int = 8765,
        categories: str = ",".join(DEFAULT_CATEGORIES),
        app_url: str = DEFAULT_APP_URL,
        open_browser: bool = True,
    ) -> None:
        """
        Serve a local folder of whole PNG/TIFF images (recursively,
        including subdirectories) to CytoRecorder's whole-image quality
        annotation workflow, and write exported quality labels to disk.

        Args:
            input_dir (str):
                Folder of whole images to review, scanned recursively.
            output_dir (str):
                Folder the exported quality_labels.csv is written into.
            project (str):
                Project name recorded on every label.
                Defaults to the input folder's own name.
            port (int):
                Local port to bind. Defaults to 8765.
            categories (str):
                Comma-separated QC categories offered in the browser.
                Defaults to 'Good,Out-of-focus,Debris'.
            app_url (str):
                Base URL of the CytoRecorder app to point at this server.
            open_browser (bool):
                Whether to open the system browser automatically.
                Defaults to True.
        """
        serve(
            input_dir=input_dir,
            output_dir=output_dir,
            project=project,
            port=port,
            categories=categories,
            app_url=app_url,
            open_browser=open_browser,
        )


def trigger() -> None:
    """
    Trigger the CLI to run.
    """
    fire.Fire(cytorecorder_localCLI)
