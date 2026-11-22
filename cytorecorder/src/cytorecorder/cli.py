"""
CLI for cytorecorder
"""

import fire
from fire.decorators import SetParseFn

from cytorecorder.main import DEFAULT_APP_URL, review


class cytorecorderCLI:
    @SetParseFn(str, "input_dir", "output_dir", "project", "app_url")
    def review(  # noqa: PLR0913 (CLI config surface: one kwarg per launch option)
        self,
        input_dir: str,
        output_dir: str,
        project: str = "",
        app_url: str = DEFAULT_APP_URL,
        open_browser: bool = True,
        force: bool = False,
        enable_voice_notes: bool = False,
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
            force (bool):
                Proceed even if output_dir already has a non-empty
                quality_labels.csv. Defaults to False: refuse and raise.
            enable_voice_notes (bool):
                Opened with a project name, CytoRecorder normally skips
                its default public-demo behavior (automatic BioImage
                Archive fetch, per-object voice notes) and just waits for
                the folder to be dragged in. Set this to open with that
                default demo behavior (including voice notes) instead.
                Defaults to False.
        """
        review(
            input_dir=input_dir,
            output_dir=output_dir,
            project=project,
            app_url=app_url,
            open_browser=open_browser,
            force=force,
            enable_voice_notes=enable_voice_notes,
        )


def trigger() -> None:
    """
    Trigger the CLI to run.
    """
    fire.Fire(cytorecorderCLI)
