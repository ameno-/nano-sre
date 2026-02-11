# PR Review Guide

This PR contains the review handoff for the initial `nano-sre` release.

## What to review first

1. `docs/ARCHITECTURE.md`
2. `docs/DESIGN_PROCESS.md`
3. `docs/INITIAL_VALIDATION.md`
4. `docker-compose.yml`
5. `nanobot/config.example.json`
6. `services/nano-sre-harness/src/server.ts`

## Expected behavior in this stack

- Nanobot acts as the secretary/orchestrator.
- `nano-sre-harness` handles deep triage and structured verdict generation.
- Keep stores and enriches alerts.
- Loki correlation flows through Keep provider invocation.

## Quick local verification

```bash
cd ~/dev/nano-sre
./scripts/bootstrap.sh
cp .env.example .env
cp nanobot/config.example.json nanobot/config.json
# fill secrets in .env and config.json
./scripts/up.sh
docker compose --profile nanobot up -d nanobot
```

Check:

- `curl http://localhost:38790/healthz`
- Keep UI at `http://localhost:38000`
- Keep API at `http://localhost:38080`
- Nanobot gateway container logs for tool invocation + progress updates

## Security reminders before VPS deploy

- Set `NANOBOT_ENV=production`
- Enforce `allowFrom` in channel config
- Set `NANO_SRE_SERVICE_TOKEN`
- Keep secrets in deployment secret manager, not in repo
