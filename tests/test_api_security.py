"""Exercise access checks without calling LiveKit or Redis."""

import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from src import interview_sessions
from src.web import InterviewUIHandler


@pytest.fixture(params=["local", "vercel"])
def endpoint(request):
    if request.param == "local":
        return InterviewUIHandler, "src.web"
    spec = importlib.util.spec_from_file_location(
        "connection_endpoint", Path("api/connection-details.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.handler, module


def make_handler(cls, body, length, code):
    handler = object.__new__(cls)
    handler.path = "/api/connection-details"
    handler.headers = {
        "Origin": "https://example.com",
        "Host": "example.com",
        "Content-Length": str(length),
        "X-Interview-Access-Code": code,
    }
    handler.rfile = io.BytesIO(body)
    handler.send_json = Mock()
    return handler


def test_invalid_code_is_rejected_before_reading_or_parsing(endpoint, monkeypatch):
    cls, module = endpoint
    monkeypatch.setenv("INTERVIEW_ACCESS_CODE", "valid-code")
    parser = Mock(side_effect=AssertionError("PDF must not be parsed"))
    monkeypatch.setattr(
        module
        if not isinstance(module, str)
        else __import__(module, fromlist=["parse_interview_inputs"]),
        "parse_interview_inputs",
        parser,
    )
    handler = make_handler(cls, b"expensive-pdf", 13, "wrong-code")
    handler.do_POST()
    parser.assert_not_called()
    assert handler.rfile.tell() == 0
    assert "valid demo access code" in str(handler.send_json.call_args)


def test_truncated_upload_is_rejected(endpoint, monkeypatch):
    cls, _ = endpoint
    monkeypatch.setenv("INTERVIEW_ACCESS_CODE", "valid-code")
    handler = make_handler(cls, b"short", 100, "valid-code")
    handler.do_POST()
    assert "upload was interrupted" in str(handler.send_json.call_args)


def test_unicode_invalid_code_is_denied_without_server_error(monkeypatch):
    monkeypatch.setenv("INTERVIEW_ACCESS_CODE", "valid-code")
    with pytest.raises(interview_sessions.AccessDeniedError):
        interview_sessions.validate_access_code("incorrect-🔒")


@pytest.mark.parametrize("payload", [b"[]", b'{"result": false}', b'{"result": "0"}'])
def test_malformed_quota_response_fails_closed(monkeypatch, payload):
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://example.com")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "test-only")

    class Response(io.BytesIO):
        pass

    monkeypatch.setattr(
        "urllib.request.urlopen", lambda *args, **kwargs: Response(payload)
    )
    with pytest.raises(RuntimeError):
        interview_sessions.consume_interview_quota("test")


def test_hosted_security_headers_preserve_same_origin_microphone():
    config = json.loads(Path("vercel.json").read_text())
    headers = {item["key"]: item["value"] for item in config["headers"][0]["headers"]}
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert "microphone=(self)" in headers["Permissions-Policy"]


def test_authorized_request_still_creates_connection(endpoint, monkeypatch):
    cls, module = endpoint
    if isinstance(module, str):
        module = __import__(module, fromlist=["parse_interview_inputs"])
    monkeypatch.setenv("INTERVIEW_ACCESS_CODE", "valid-code")
    parser = Mock(return_value=("Job description", "Resume text"))
    quota = Mock()
    create = Mock(return_value={"participantToken": "test-token"})
    monkeypatch.setattr(module, "parse_interview_inputs", parser)
    monkeypatch.setattr(module, "consume_interview_quota", quota)
    monkeypatch.setattr(module, "create_interview_connection", create)
    handler = make_handler(cls, b"upload", 6, "valid-code")
    handler.do_POST()
    parser.assert_called_once()
    quota.assert_called_once()
    create.assert_called_once_with("Job description", "Resume text")
    assert "test-token" in str(handler.send_json.call_args)


@pytest.mark.parametrize(
    "origin,length", [("https://other.example", 6), ("https://example.com", 4_000_001)]
)
def test_cross_origin_and_oversized_requests_are_not_read(endpoint, origin, length):
    cls, _ = endpoint
    handler = make_handler(cls, b"upload", length, "unused")
    handler.headers["Origin"] = origin
    handler.do_POST()
    assert handler.rfile.tell() == 0
    handler.send_json.assert_called_once()
