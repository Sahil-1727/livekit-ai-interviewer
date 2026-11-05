"""Expose the public demo-access request email, never the invite code."""

import json
import os
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel entrypoint name
    def do_GET(self) -> None:
        body = json.dumps(
            {"request_email": os.getenv("INTERVIEW_ACCESS_REQUEST_EMAIL", "")}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string: str, *args: object) -> None:
        return
