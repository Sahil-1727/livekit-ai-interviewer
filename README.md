# Fieldnote AI Interviewer

Fieldnote is a voice-based technical interview demo. It creates a personalized interview from a job description and a candidate's PDF resume, then presents an interview scorecard.

## Live demo

**Website:** [https://livekit-ai-interviewer.vercel.app/](https://livekit-ai-interviewer.vercel.app/)

The demo is invite-only. Use the access code supplied by the site owner, enter a job description, upload a text-based PDF resume, and start the interview. The **Request demo access** link opens a prefilled email request.

## What it does

- Runs a real-time voice interview tailored to the job description and resume.
- Asks ten questions total, counting follow-up questions.
- Supports ending early and generating a partial scorecard from the interview so far.
- Shows the scorecard on a separate results page. When a candidate ends early, the agent only announces that the scorecard is ready; it does not speak the scores.
- Requires an invite code and applies daily interview limits to control AI usage.
- Extracts resume text on the server. The LiveKit API secret and interview documents are not sent to the browser.

## How the app is structured

| Path | Purpose |
| --- | --- |
| `public/` | Interview setup page, browser-side LiveKit connection, styling, and scorecard page. |
| `api/connection-details.py` | Vercel endpoint that validates access, checks quotas, extracts submitted inputs, dispatches the LiveKit agent, and returns a short-lived room token. |
| `api/access-config.py` | Public endpoint that supplies the configured access-request email to the UI. |
| `src/agent.py` | LiveKit voice interviewer and scorecard generation. |
| `src/interview_sessions.py` | Resume/JD validation, PDF text extraction, invite-code checks, quota accounting, and LiveKit dispatch. |
| `src/web.py` | Local development web server for the same UI and API flow. |

The UI is hosted on Vercel. The voice agent runs separately on LiveKit Cloud. A Git push can deploy the Vercel app; changes to the Python voice agent must also be deployed to LiveKit Cloud.

## Local development

### Requirements

- Python 3.12
- [`uv`](https://docs.astral.sh/uv/)
- [LiveKit CLI](https://docs.livekit.io/reference/developer-tools/livekit-cli/)
- A LiveKit Cloud project
- An Upstash Redis database with REST API access

### Configure environment variables

Copy `.env.example` to `.env.local` and fill in the values. Keep `.env.local` private; it is ignored by Git.

Required LiveKit values:

```dotenv
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Access and quota values:

```dotenv
INTERVIEW_ACCESS_CODE=
INTERVIEW_ACCESS_REQUEST_EMAIL=
INTERVIEW_DAILY_LIMIT_PER_CODE=3
INTERVIEW_DAILY_LIMIT_GLOBAL=10
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

`UPSTASH_REDIS_REST_URL` must be the HTTPS REST endpoint from Upstash, not a `rediss://` connection string. The endpoint fails closed if the access code or quota storage is missing or unavailable.

### Start the app

Open two terminals in the project directory.

**Terminal 1 — local UI:**

```console
uv sync
uv run src/web.py
```

**Terminal 2 — LiveKit agent worker:**

```console
lk agent dev --log-level DEBUG
```

The agent command prints a development deployment ID such as `dev-...`. For local interviews, set `LIVEKIT_AGENT_DEPLOYMENT` in `.env.local` to that exact ID, restart the UI server, and keep the worker running. A new development worker may get a different deployment ID.

Open [http://localhost:8000](http://localhost:8000), enter the invite code, paste a job description, attach a text-based PDF resume under 3.9 MB, and choose **Begin 10-question interview**. Keep both terminals open during the interview.

## Access codes and usage limits

The current setup uses one shared invite code configured by `INTERVIEW_ACCESS_CODE`. Share it only with approved testers. Changing this environment variable requires a redeploy before the new code takes effect. The per-code quota applies to everyone who shares that code; the global quota limits all interviews for the day.

The request email comes from `INTERVIEW_ACCESS_REQUEST_EMAIL`. For Gmail addresses, the UI opens a prefilled Gmail compose page; other addresses use the tester's configured email app.

Default limits are three interviews per code per day and ten total interviews per day. Override them using `INTERVIEW_DAILY_LIMIT_PER_CODE` and `INTERVIEW_DAILY_LIMIT_GLOBAL`. Counts are stored in Upstash Redis and reset daily.

## Production deployment

### Vercel web app

The Vercel project is connected to this GitHub repository. Pushing to `main` triggers a Vercel production deployment.

In **Vercel → Project Settings → Environment Variables**, configure these for Production (and Preview if you use Preview deployments):

| Variable | Description |
| --- | --- |
| `LIVEKIT_URL` | LiveKit Cloud project URL. |
| `LIVEKIT_API_KEY` | LiveKit API key. |
| `LIVEKIT_API_SECRET` | LiveKit API secret. |
| `INTERVIEW_ACCESS_CODE` | Shared tester invite code. |
| `INTERVIEW_ACCESS_REQUEST_EMAIL` | Email address for access requests. |
| `INTERVIEW_DAILY_LIMIT_PER_CODE` | Daily interview cap for the shared code. |
| `INTERVIEW_DAILY_LIMIT_GLOBAL` | Total daily interview cap. |
| `UPSTASH_REDIS_REST_URL` | Upstash HTTPS REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token. |

Leave `LIVEKIT_AGENT_DEPLOYMENT` **unset** in Vercel so interview sessions use the LiveKit production agent. Do not upload `.env.local` or commit credentials.

### LiveKit voice agent

Deploy or update the production agent from the project root:

```console
lk cloud auth
lk project set-default firstaiagent
lk agent deploy
```

`lk agent deploy` targets the production deployment by default. Verify it with:

```console
lk agent status
```

Vercel deployment and LiveKit agent deployment are separate. After changing `src/agent.py`, deploy the LiveKit agent as well as pushing the repository if the UI or API also changed.

## Troubleshooting

- **Access denied:** Check that the entered code matches `INTERVIEW_ACCESS_CODE` in the environment used by the site. On Vercel, redeploy after changing environment variables.
- **Demo access unavailable:** Confirm the Upstash HTTPS REST URL and token are configured in Vercel or `.env.local`.
- **Connected but no interviewer:** Confirm the LiveKit production agent is running with `lk agent status`. For local development, keep `lk agent dev --log-level DEBUG` running and ensure the local UI's `LIVEKIT_AGENT_DEPLOYMENT` matches the worker's current deployment ID.
- **No scorecard after ending early:** Check the LiveKit agent logs with `lk agent logs`. Changes to `src/agent.py` take effect in production only after `lk agent deploy` completes.
- **Port 8000 is already in use:** Stop the other local UI process with `Ctrl+C` or choose another available port by setting `UI_PORT` in `.env.local`.

## Security notes

- Never commit `.env.local`, LiveKit secrets, or the Upstash token.
- Rotate a token immediately if it is exposed.
- Treat the invite code as a shared demo password; a short code is easy to guess.
- The scorecard is kept in the candidate's browser tab for display and is not a persistent results database.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
