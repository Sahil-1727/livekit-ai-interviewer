"""Local web UI and interview setup endpoint for the AI interviewer."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "public"
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.interview_sessions import (  # noqa: E402 - project root added above
    MAX_REQUEST_BYTES,
    AccessDeniedError,
    consume_interview_quota,
    create_interview_connection,
    parse_interview_inputs,
    validate_access_code,
)

load_dotenv(BASE_DIR / ".env.local")


class InterviewUIHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/connection-details":
            self.send_error(404)
            return
        if not self._same_origin():
            self.send_json({"detail": "Requests must come from this site."}, status=403)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json({"detail": "Invalid request size."}, status=400)
            return
        if content_length <= 0:
            self.send_json(
                {"detail": "Enter the job description and upload a resume PDF."},
                status=400,
            )
            return
        if content_length > MAX_REQUEST_BYTES:
            self.send_json(
                {"detail": "The resume PDF must be smaller than 4 MB."},
                status=413,
            )
            return

        try:
            body = self.rfile.read(content_length)
            job_description, resume = parse_interview_inputs(
                self.headers.get("Content-Type", ""), body
            )
            fingerprint = validate_access_code(
                self.headers.get("X-Interview-Access-Code")
            )
            consume_interview_quota(fingerprint)
            connection = create_interview_connection(job_description, resume)
            self.send_json(connection)
        except AccessDeniedError as error:
            self.send_json(
                {"detail": str(error)},
                status=429 if "limit" in str(error).lower() else 401,
            )
        except RuntimeError:
            self.send_json(
                {
                    "detail": "Demo access is temporarily unavailable. Please try again later."
                },
                status=503,
            )
        except ValueError as error:
            self.send_json({"detail": str(error)}, status=400)
        except Exception:
            self.send_json(
                {"detail": "Could not start the interview. Please try again shortly."},
                status=502,
            )

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/" or path in {
            "/app.js",
            "/scorecard.html",
            "/scorecard.js",
            "/styles.css",
        }:
            file_path = WEB_DIR / ("index.html" if path == "/" else path[1:])
            content_type = {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
            }[file_path.suffix]
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            self.wfile.write(file_path.read_bytes())
        elif path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        elif path == "/api/access-config":
            self.send_json(
                {"request_email": os.getenv("INTERVIEW_ACCESS_REQUEST_EMAIL", "")}
            )
        else:
            self.send_error(404)

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        request_host = self.headers.get("Host")
        return bool(
            origin
            and request_host
            and urlparse(origin).netloc == request_host
            and urlparse(origin).scheme in {"http", "https"}
        )

    def send_json(self, data: dict[str, object], status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string: str, *args: object) -> None:
        if self.path.startswith("/api/connection-details"):
            return
        super().log_message(format_string, *args)


if __name__ == "__main__":
    port = int(os.getenv("UI_PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), InterviewUIHandler)
    print(f"Interview UI running at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down interview UI")
    finally:
        server.server_close()
