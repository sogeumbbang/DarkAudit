"""Load local configuration before API modules read environment variables."""

from pathlib import Path

from dotenv import load_dotenv


# Keep explicitly supplied deployment environment variables authoritative.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
