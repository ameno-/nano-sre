# Adding New Providers to nano-sre

This guide shows how to add a new provider while preserving the existing Loki-style integration pattern and workflows.

## Integration model

`nano-sre` uses a 3-layer pattern:

1. **Keep**
- Owns provider auth/config
- Executes provider queries through `POST /providers/{id}/invoke/{method}`

2. **nano-sre-harness**
- Pulls alert context from Keep
- Pulls evidence from providers via Keep
- Merges evidence into triage prompt
- Emits progress events + structured verdict

3. **Nanobot**
- Calls harness tools
- Streams incremental updates to chat
- Sends final summary + HTML report

If you follow the Loki path, you usually do not need new Nanobot tools.

## Provider types

- **Alert-source providers**: send alerts into Keep (Sentry, Grafana Alerting)
- **Evidence-query providers**: queried during triage (Loki, log/search/metrics APIs)

This guide focuses on evidence-query providers because they affect harness logic.

## Step 1: Install and validate provider in Keep

Install provider in Keep UI/API first. Then validate it with `keep-curl`.

```bash
cd ~/dev/nano-sre
./scripts/keep-curl.sh -sS 'http://localhost:38080/providers' | python3 -m json.tool | sed -n '1,200p'
```

Find the installed provider `id` and confirm invoke method (`_query` or provider-specific method).

## Step 2: Add env wiring

In `.env` and `docker-compose.yml`, add a provider ID variable.

Example naming:
- `KEEP_<PROVIDER>_PROVIDER_ID` for Keep-side IDs
- `NANO_SRE_<PROVIDER>_...` for harness behavior flags

Keep this naming consistent across docs and code.

## Step 3: Extend harness config

Edit:
- `services/nano-sre-harness/src/config.ts`

Add config entries with defaults and env lookups.

Pattern to follow:
- keep Loki style fallback behavior
- no provider config should crash triage if unset

## Step 4: Add Keep client helper

Edit:
- `services/nano-sre-harness/src/keepClient.ts`

Re-use `invokeProvider(...)` and add a typed helper like `lokiQueryRange(...)`.

Rules:
- keep payload formatting in one helper method
- keep raw provider response intact for debug

## Step 5: Merge evidence in engine

Edit:
- `services/nano-sre-harness/src/engine.ts`

Follow Loki flow:
1. compute default query from alert labels/service
2. emit progress event (`<provider>_query`)
3. invoke Keep provider helper
4. normalize evidence into prompt text
5. include provider metadata in `debug`

Do not remove Loki behavior unless intentionally replacing it.

## Step 6: Keep workflows clean

If the new provider is only additional evidence:
- keep existing tool entrypoint (`sre_triage_alert_with_updates`)
- no new Telegram flow needed
- no user retraining needed

If the new provider introduces a separate triage mode:
- add a dedicated tool in Nanobot
- add/update a skill doc in `nanobot/workspace/skills/`
- keep output contract the same (summary + HTML + correlation_id)

## Step 7: Validate end-to-end

Use this checklist:

1. harness build succeeds
```bash
cd ~/dev/nano-sre/services/nano-sre-harness
npm install --no-audit --no-fund
npm run build
```

2. compose config resolves
```bash
cd ~/dev/nano-sre
docker compose config --no-interpolate >/tmp/nano-sre-compose.out
```

3. provider invoke works from Keep
```bash
cd ~/dev/nano-sre
./scripts/keep-curl.sh -sS -X POST \
  'http://localhost:38080/providers/<provider-id>/invoke/<method>' \
  -H 'Content-Type: application/json' \
  -d '{"query":"..."}'
```

4. triage emits progress and final artifact
- run a triage request through Nanobot
- confirm progress phases include your provider step
- confirm final includes summary + HTML report path

## Step 8: Update docs

Update at minimum:
- `README.md` (new env vars and provider notes)
- `docs/INITIAL_VALIDATION.md` (new validation evidence)
- `docs/ARCHITECTURE.md` (if data flow changed)

## Guardrails

- Never hardcode secrets or provider IDs
- Keep provider integration optional and feature-gated by env
- Preserve correlation IDs in events and responses
- Preserve idempotent behavior for job/workstream APIs
