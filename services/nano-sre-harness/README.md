# nano-sre-harness

High-power triage engine for `nano-sre`.

## What it does

- Reads alerts from Keep
- Pulls logs from Loki via Keep provider invocation
- Runs synthesis via Pi Agent SDK + model routing provider
- Returns strict JSON verdicts
- Persists job/workstream state
- Emits progress events for chat streaming

## Environment variables

- `OPENROUTER_API_KEY` (required)
- `KEEP_BASE_URL` (default `http://keep-backend:8080`)
- `KEEP_X_API_KEY` (default `local-dev`)
- `KEEP_LOKI_PROVIDER_ID` (optional, required for log correlation)
- `NANO_SRE_PROVIDER` (default `openrouter`)
- `NANO_SRE_MODEL_ID` (default `google/gemini-3-flash-preview`)
- `NANO_SRE_THINKING_LEVEL` (`off|low|medium|high`, default `high`)
- `NANO_SRE_SERVICE_TOKEN` (optional)
- `NANO_SRE_STORE_PATH` (default `/tmp/nano-sre-store.json`)

Backwards-compatibility aliases are also accepted (`PI_*`).

## API highlights

- `GET /healthz`
- `POST /v1/triage/alert`
- `POST /v1/jobs/triage/alert`
- `GET /v1/jobs/:job_id`
- `GET /v1/jobs/:job_id/events`
- `POST /v1/workstreams/open`
- `POST /v1/workstreams/:workstream_id/jobs/triage`
- `GET /v1/workstreams/:workstream_id`
- `POST /v1/workstreams/:workstream_id/close`
