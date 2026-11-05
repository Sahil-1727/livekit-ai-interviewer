"""Validate interview inputs and start a private LiveKit session."""

import asyncio
import datetime
import hashlib
import json
import os
import secrets
from email import policy
from email.parser import BytesParser
from io import BytesIO

from livekit import api
from pypdf import PdfReader

MAX_REQUEST_BYTES = 4_000_000
MAX_DOCUMENT_BYTES = 3_900_000
MAX_JOB_DESCRIPTION_CHARS = 12_000
MAX_RESUME_CHARS = 8_000
MIN_DOCUMENT_CHARS = 40
AGENT_NAME = "livekit-ai-interviewer"
ACCESS_CODE_HEADER = "X-Interview-Access-Code"


class AccessDeniedError(ValueError):
    """Raised when a demo access code is missing or invalid."""


def validate_access_code(provided_code: str | None) -> str:
    """Check the configured demo access code using constant-time comparison."""
    expected_code = os.getenv("INTERVIEW_ACCESS_CODE", "").strip()
    if not expected_code:
        raise RuntimeError("Interview demo access is not configured.")
    if not provided_code or not secrets.compare_digest(provided_code, expected_code):
        raise AccessDeniedError("Enter a valid demo access code to continue.")
    return hashlib.sha256(expected_code.encode()).hexdigest()[:16]


def consume_interview_quota(code_fingerprint: str) -> None:
    """Atomically enforce a daily global cap and a per-code daily cap."""
    max_per_code = _positive_limit("INTERVIEW_DAILY_LIMIT_PER_CODE", default=3)
    max_global = _positive_limit("INTERVIEW_DAILY_LIMIT_GLOBAL", default=10)
    storage_url = os.getenv("UPSTASH_REDIS_REST_URL")
    storage_token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
    if not storage_url or not storage_token:
        raise RuntimeError("Interview usage limits are not configured.")

    day = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    global_key = f"interview-quota:{day}:global"
    code_key = f"interview-quota:{day}:code:{code_fingerprint}"
    script = (
        "local global_count = tonumber(redis.call('GET', KEYS[1]) or '0'); "
        "local code_count = tonumber(redis.call('GET', KEYS[2]) or '0'); "
        "if global_count >= tonumber(ARGV[1]) then return 1 end; "
        "if code_count >= tonumber(ARGV[2]) then return 2 end; "
        "global_count = redis.call('INCR', KEYS[1]); "
        "code_count = redis.call('INCR', KEYS[2]); "
        "if global_count == 1 then redis.call('EXPIRE', KEYS[1], 172800) end; "
        "if code_count == 1 then redis.call('EXPIRE', KEYS[2], 172800) end; "
        "return 0"
    )
    import urllib.error
    import urllib.request

    request = urllib.request.Request(
        f"{storage_url.rstrip('/')}/",
        data=json.dumps(
            ["EVAL", script, "2", global_key, code_key, max_global, max_per_code]
        ).encode(),
        headers={
            "Authorization": f"Bearer {storage_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            result = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise RuntimeError(
            "Interview usage limits are temporarily unavailable."
        ) from error

    if result.get("error"):
        raise RuntimeError("Interview usage limits are temporarily unavailable.")
    quota_result = result.get("result")
    if quota_result == 1:
        raise AccessDeniedError(
            "Today's demo interview limit has been reached. Please try again tomorrow."
        )
    if quota_result == 2:
        raise AccessDeniedError(
            "This demo code has reached its daily interview limit. Please request a fresh code."
        )
    if quota_result != 0:
        raise RuntimeError("Interview usage limits returned an invalid response.")


def _positive_limit(name: str, *, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer.") from error
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer.")
    return value


def parse_interview_inputs(content_type: str, body: bytes) -> tuple[str, str]:
    """Parse the JD text and resume PDF, returning bounded extracted text."""
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError("The resume PDF must be smaller than 4 MB.")

    headers = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
    message = BytesParser(policy=policy.default).parsebytes(headers + body)
    if not message.is_multipart():
        raise ValueError("Enter the job description and upload a resume PDF.")

    job_description = ""
    resume_pdf: bytes | None = None
    for part in message.iter_parts():
        field = part.get_param("name", header="content-disposition")
        if field == "job_description":
            if job_description:
                raise ValueError("Enter one job description.")
            job_description = (part.get_content() or "").strip()
        elif field == "resume_pdf":
            if resume_pdf is not None:
                raise ValueError("Upload one resume PDF.")
            filename = part.get_filename() or ""
            resume_pdf = part.get_payload(decode=True) or b""
            if not filename.lower().endswith(".pdf") or not resume_pdf.startswith(
                b"%PDF-"
            ):
                raise ValueError("The resume upload must be a valid PDF file.")

    if len(job_description) < MIN_DOCUMENT_CHARS:
        raise ValueError("Enter a job description with at least 40 characters.")
    if len(job_description) > MAX_JOB_DESCRIPTION_CHARS:
        raise ValueError("The job description must be 12,000 characters or fewer.")
    if not resume_pdf:
        raise ValueError("Upload your resume as a PDF before starting.")
    if len(resume_pdf) > MAX_DOCUMENT_BYTES:
        raise ValueError("The resume PDF must be smaller than 4 MB.")

    resume = _extract_pdf_text(resume_pdf, "The resume PDF", MAX_RESUME_CHARS)
    return job_description, resume


def _extract_pdf_text(data: bytes, label: str, max_chars: int) -> str:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise ValueError(f"{label} is password-protected. Upload an unlocked PDF.")
        if len(reader.pages) > 80:
            raise ValueError(f"{label} has too many pages (maximum 80).")

        extracted: list[str] = []
        char_count = 0
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if not page_text:
                continue
            remaining = max_chars - char_count
            if remaining <= 0:
                break
            extracted.append(page_text[:remaining])
            char_count += min(len(page_text), remaining)
        text = "\n".join(extracted).strip()
    except ValueError:
        raise
    except Exception as error:
        raise ValueError(
            f"Could not read {label}. Upload a valid, unlocked PDF."
        ) from error

    if len(text) < MIN_DOCUMENT_CHARS:
        raise ValueError(
            f"{label} has too little extractable text. Upload a text-based PDF or "
            "OCR the scanned document first."
        )
    return text


def create_interview_connection(job_description: str, resume: str) -> dict[str, str]:
    """Dispatch an agent with private job metadata and return a participant token."""
    livekit_url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    if not all((livekit_url, api_key, api_secret)):
        raise ValueError("LiveKit credentials are not configured.")

    room_name = f"interview-{secrets.token_urlsafe(12)}"
    identity = f"candidate-{secrets.token_urlsafe(8)}"
    metadata = json.dumps(
        {
            "job_description": job_description,
            "resume": resume,
        }
    )
    dispatch_args: dict[str, str] = {
        "agent_name": AGENT_NAME,
        "room": room_name,
        "metadata": metadata,
    }
    deployment = os.getenv("LIVEKIT_AGENT_DEPLOYMENT")
    if deployment:
        dispatch_args["deployment"] = deployment

    async def dispatch_agent() -> None:
        async with api.LiveKitAPI(livekit_url, api_key, api_secret) as livekit_api:
            await livekit_api.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(**dispatch_args)
            )

    asyncio.run(dispatch_agent())

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
    )
    return {
        "serverUrl": livekit_url,
        "participantToken": token.to_jwt(),
        "roomName": room_name,
        "participantName": "Candidate",
    }
