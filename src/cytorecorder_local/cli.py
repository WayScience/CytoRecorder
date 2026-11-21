"""
CLI for cytorecorder_local
"""

import fire

from cytorecorder_local.main import show_message


class cytorecorder_localCLI:
    def show_message(
        self,
        message: str = "Hello, world!",
    ) -> None:
        """
        CLI interface for show_message.

        Args:
            message (str):
                The message to print.
                Defaults to 'Hello, world!'.

        """
        print(show_message(message=message))


def trigger() -> None:
    """
    Trigger the CLI to run.
    """
    fire.Fire(cytorecorder_localCLI)
