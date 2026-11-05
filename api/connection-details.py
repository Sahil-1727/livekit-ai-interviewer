"""Issue a short-lived LiveKit token and dispatch the production interviewer."""

import datetime
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

from livekit import api


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        origin = self.headers.get("Origin")
        request_host = self.headers.get("Host")
        if (
            not origin
            or not request_host
            or urlparse(origin).netloc != request_host
            or urlparse(origin).scheme not in {"http", "https"}
        ):
            self.send_json(403, {"detail": "Requests must come from this site"})
            return

        livekit_url = os.getenv("LIVEKIT_URL")
        api_key = os.getenv("LIVEKIT_API_KEY")
        api_secret = os.getenv("LIVEKIT_API_SECRET")
        if not all((livekit_url, api_key, api_secret)):
            self.send_json(500, {"detail": "LiveKit credentials are not configured"})
            return

        room_name = f"interview-{secrets.token_urlsafe(12)}"
        identity = f"candidate-{secrets.token_urlsafe(8)}"
        dispatch = api.RoomAgentDispatch(agent_name="livekit-ai-interviewer")
        deployment = os.getenv("LIVEKIT_AGENT_DEPLOYMENT")
        if deployment:
            dispatch.deployment = deployment

        token = (
            api.AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name("Candidate")
            .with_ttl(datetime.timedelta(minutes=10))
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=room_name,
                    can_publish=True,
                    can_subscribe=True,
                )
            )
            .with_room_config(api.RoomConfiguration(agents=[dispatch]))
        )
        self.send_json(
            200,
            {
                "serverUrl": livekit_url,
                "participantToken": token.to_jwt(),
                "roomName": room_name,
                "participantName": "Candidate",
            },
        )

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def send_json(self, status: int, data: dict[str, str]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string: str, *args: object) -> None:
        return
