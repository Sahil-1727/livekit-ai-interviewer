"""Accept a job description and resume PDF, then return a LiveKit token."""

import json
import logging
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

from src.interview_sessions import (
    MAX_REQUEST_BYTES,
    AccessDeniedError,
    consume_interview_quota,
    create_interview_connection,
    parse_interview_inputs,
    validate_access_code,
)

logger = logging.getLogger("interview-api")


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel entrypoint name
    def do_POST(self) -> None:
        if not self._same_origin():
            self.send_json(403, {"detail": "Requests must come from this site."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"detail": "Invalid request size."})
            return
        if content_length <= 0:
            self.send_json(
                400, {"detail": "Enter the job description and upload a resume PDF."}
            )
            return
        if content_length > MAX_REQUEST_BYTES:
            self.send_json(413, {"detail": "The resume PDF must be smaller than 4 MB."})
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
        except AccessDeniedError as error:
            self.send_json(
                429 if "limit" in str(error).lower() else 401, {"detail": str(error)}
            )
            return
        except RuntimeError:
            logger.exception("Interview access control is not available")
            self.send_json(
                503,
                {
                    "detail": "Demo access is temporarily unavailable. Please try again later."
                },
            )
            return
        except ValueError as error:
            self.send_json(400, {"detail": str(error)})
            return
        except Exception:
            logger.exception("Could not create interview session")
            self.send_json(
                502,
                {"detail": "Could not start the interview. Please try again shortly."},
            )
            return

        self.send_json(200, connection)

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        request_host = self.headers.get("Host")
        return bool(
            origin
            and request_host
            and urlparse(origin).netloc == request_host
            and urlparse(origin).scheme in {"http", "https"}
        )

    def send_json(self, status: int, data: dict[str, object]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string: str, *args: object) -> None:
        return
