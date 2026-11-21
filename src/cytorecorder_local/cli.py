"""
CLI for cytorecorder_local
"""

import fire

from cytorecorder_local.main import DEFAULT_APP_URL, review


class cytorecorder_localCLI:
    def review(
        self,
        input_dir: str,
        output_dir: str,
        project: str = "",
        app_url: str = DEFAULT_APP_URL,
        open_browser: bool = True,
    ) -> None:
        """
        Help a human complete a CytoRecorder whole-image quality review:
        confirms real images exist under input_dir (recursively, including
        subdirectories) and opens the hosted CytoRecorder app. The human
        then drags input_dir into the app themselves and, when done,
        exports quality_labels.csv into output_dir from the browser.

        Args:
            input_dir (str):
                Folder of whole images to review, scanned recursively.
            output_dir (str):
                Folder to save the exported quality_labels.csv into.
            project (str):
                Project name recorded on every label.
                Defaults to the input folder's own name.
            app_url (str):
                Base URL of the hosted CytoRecorder app to open.
            open_browser (bool):
                Whether to open the system browser automatically.
                Defaults to True.
        """
        review(
            input_dir=input_dir,
            output_dir=output_dir,
            project=project,
            app_url=app_url,
            open_browser=open_browser,
        )


def trigger() -> None:
    """
    Trigger the CLI to run.
    """
    fire.Fire(cytorecorder_localCLI)
