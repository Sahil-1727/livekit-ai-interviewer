"""Return the public, non-sensitive interview title and experience level."""

import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        config = json.loads(
            (BASE_DIR / "interview_config.json").read_text(encoding="utf-8")
        )
        body = json.dumps(
            {
                "role": config.get("role"),
                "experience_level": config.get("experience_level"),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string: str, *args: object) -> None:
        return
