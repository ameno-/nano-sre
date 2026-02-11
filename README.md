<div align="center">
  <img src="assets/nano-sre-logo.png" alt="NANO-SRE logo" width="360" />
  <h1><code>NANO-SRE</code></h1>
  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge" /></a>
    <img alt="Stack: Keep, Nanobot, Pi SDK" src="https://img.shields.io/badge/Stack-Keep%20%7C%20Nanobot%20%7C%20Pi%20SDK-0f172a?style=for-the-badge" />
    <img alt="Deployment: Local and VPS" src="https://img.shields.io/badge/Deployment-Local%20%2B%20VPS-2563eb?style=for-the-badge" />
    <img alt="Model Routing: OpenRouter" src="https://img.shields.io/badge/Model%20Routing-OpenRouter-f97316?style=for-the-badge" />
  </p>
  <p><strong>Open-source incident triage stack for solo founders and small teams.</strong></p>
</div>

`NANO-SRE` combines:
- **Nanobot** as the conversational secretary (Telegram-first UX)
- **Keep** as the alert aggregation and persistence layer
- **nano-sre-harness** as the high-power triage engine (Pi Agent SDK + OpenRouter)

## Why This Architecture

1. **Nanobot stays lightweight**: great UX, channel routing, periodic summaries, operator-friendly communication.
2. **Harness does deep reasoning**: long triage sessions, correlation, structured verdicts, HTML artifacts.
3. **Keep is the source of truth**: alert history, enrichment, provider integrations (Sentry/Grafana/Loki/etc).
4. **Gemini path for multimodal triage**: image-first debugging and rapid synthesis with low latency and low cost.

This separation keeps the chat interface stable while swapping models/harness behavior over time.

## Upcoming Features

- [ ] Provider onboarding generator (one-command scaffold + validation checklist)
- [ ] Additional providers: GitLab issues/MRs, AWS health/security feeds, CVE enrichment sources
- [ ] Loki provider quality upgrades (query presets, service-aware defaults, faster triage pivots)
- [ ] Smarter Telegram message chunking (long-response splitting with readable section boundaries)
- [ ] Incremental progress UX improvements (phase updates, retries, clearer completion markers)
- [ ] Structured HTML incident report improvements (mobile-first layout, evidence tables, timeline blocks)
- [ ] Onboarding and setup refinements (guided `.env` validation, preflight checks, first-run assistant)
- [ ] Slack channel integration parity with Telegram workflow
- [ ] Email integration parity (digest + incident escalation with report attachments)
- [ ] Core SRE bot improvements (workstream fan-out, multi-agent coordination, stronger dedup/idempotency)
- [ ] Policy and guardrails hardening (ack-required silencing, escalation rules, role-based notifications)
- [ ] Persistent cache strategy for repeated queries (Keep/Loki query result memoization with TTL)

## Core Outcomes

- Incremental triage updates in chat
- Correlation IDs across services
- Structured verdicts (`severity`, `category`, `confidence`, actions)
- Portable HTML incident reports
- Local-first dev flow with VPS-ready deployment parity

## Open Source And Free-Model Friendly

Everything in this project is open source.

You can run the stack with low cost or near-zero model cost by allowing OpenRouter to route to free models (when available). For production workloads, pin to a reliable paid model.

## OSS Projects Used

Primary open-source projects used directly in this stack (excluding transitive package dependencies):

- **NANO-SRE (this project)**: https://github.com/ameno-/nano-sre
- **Keep** (alert aggregation + persistence): https://github.com/keephq/keep
- **Nanobot** (secretary/orchestrator runtime): https://github.com/HKUDS/nanobot
- **Pi Mono / Coding Agent SDK** (harness foundation): https://github.com/badlogic/pi-mono
- **Pi SDK docs used for integration design**: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md
- **OpenClaw Telegram implementation** (reference patterns): https://github.com/openclaw/openclaw/tree/main/src/telegram
- **Soketi** (Keep websocket transport in local stack): https://github.com/soketi/soketi
- **Fastify** (harness API server): https://github.com/fastify/fastify
- **TypeScript** (harness implementation language): https://github.com/microsoft/TypeScript
- **LiteLLM** (LLM provider routing used by Nanobot): https://github.com/BerriAI/litellm
- **python-telegram-bot** (Telegram transport library used by Nanobot): https://github.com/python-telegram-bot/python-telegram-bot

## Repository Layout

- `docker-compose.yml`: local stack orchestration
- `services/nano-sre-harness/`: custom triage harness (Pi Agent SDK)
- `nanobot/config.example.json`: baseline Nanobot config
- `nanobot/workspace/`: starter identity/persona docs (PII-free)
- `docs/ARCHITECTURE.md`: service map + sequence diagrams
- `docs/DESIGN_PROCESS.md`: design journey, tradeoffs, and validation history
- `docs/INITIAL_VALIDATION.md`: initial verification checklist and outcomes
- `docs/PR_REVIEW_GUIDE.md`: review order + verification checklist for this release
- `docs/ADDING_PROVIDERS.md`: step-by-step provider integration playbook (Loki-style)
- `docs/prompts/ONE_SHOT_ADD_PROVIDER.md`: copy/paste one-shot implementation prompt
- `scripts/`: bootstrap/up/down helpers

## Quick Start (Local)

1. Prepare deps and config:

```bash
cd ~/dev/nano-sre
./scripts/bootstrap.sh
cp .env.example .env
cp nanobot/config.example.json nanobot/config.json
```

2. Fill secrets in `.env`:
- `OPENROUTER_API_KEY`
- `KEEP_LOKI_PROVIDER_ID` (after installing Loki provider in Keep)
- `NANO_SRE_SERVICE_TOKEN` (recommended)

3. Start services:

```bash
./scripts/up.sh
```

4. Start Nanobot service (optional profile):

```bash
docker compose --profile nanobot up -d nanobot
```

5. Access endpoints:
- Keep UI: `http://localhost:38000`
- Keep API: `http://localhost:38080`
- nano-sre-harness: `http://localhost:38790/healthz`
- Nanobot gateway: `http://localhost:18790`

## VPS Migration

Use the same compose/env layout on VPS to minimize reconfiguration.

- Keep `.env` contract identical
- Reuse `nanobot/config.json` with production-safe allowlists
- Point Telegram and provider credentials to server-managed secrets
- Set `NANOBOT_ENV=production`

See `docs/ARCHITECTURE.md` and `docs/DESIGN_PROCESS.md` for full flow.
