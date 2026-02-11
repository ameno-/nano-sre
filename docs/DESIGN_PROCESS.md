# Design Process and Decisions

## Problem framing

Primary pain: too many signals, not enough synthesis.

Goal: build an always-on triage teammate that can ingest noisy infra/app events and produce high-signal, actionable summaries for a tiny team.

## Journey summary

1. **Initial stack exploration**
- Evaluated Nanobot as the conversational shell
- Evaluated Keep as aggregation + persistence
- Confirmed Keep and Nanobot can run safely in same Docker network sandbox

2. **Provider validation first**
- Verified Sentry provider scopes and ingestion path
- Verified Grafana/Loki access and label discovery
- Confirmed Keep could query Loki through provider invoke path

3. **Early Gemini integration friction**
- Direct Google Gemini integration had operational friction:
  - token/type mismatches
  - inconsistent model endpoint behavior (`GeminiException`, model discovery confusion)
  - slower iteration in local debugging loop

4. **Key architecture decision**
- Keep Nanobot as the **secretary** (chat UX, routing, formatting, progress)
- Move deep reasoning into a **custom harness** using Pi Agent SDK
- Route Gemini through **OpenRouter** for simpler keying and model control

5. **Custom harness implementation**
- Built `nano-sre-harness` service with:
  - Keep alert fetch + fallback id resolution
  - Loki query via Keep provider
  - Pi Agent session and strict JSON verdict schema
  - job/workstream model with persistent storage
  - event stream API for incremental updates
  - correlation IDs and optional service-token auth

6. **Nanobot orchestration extensions**
- Added harness tools:
  - `sre_triage_alert`
  - `sre_triage_alert_job_start`
  - `sre_triage_job_status`
  - `sre_triage_alert_with_updates`
- Added Telegram profile adaptation and runtime safety checks
- Added trace/debug mode for prompt + tool call visibility

## Initial validation outcomes

- Harness health check passed with model resolution
- End-to-end triage call succeeded for live alert IDs
- Event streaming produced multiple incremental updates before final verdict
- Final output included text verdict + HTML artifact
- Debug artifacts captured prompt/system prompt/event types for auditability

## Final architecture outcome

- **Nanobot**: reliable operator interface, personalized communication, incremental progress
- **Keep**: persistent incident ledger and provider abstraction
- **nano-sre-harness**: deterministic triage pipeline with multimodal-ready model layer

This yields a practical "small-team SRE copilot" with clean boundaries and low operational overhead.

## Why Gemini in this design

Gemini is favored for multimodal triage workflows:
- screenshot-first debugging
- future support for voice/video evidence
- fast synthesis cycles for incident response

The system keeps provider/model abstraction in the harness so you can switch models with minimal impact to Nanobot UX.

## Operational recommendations

- Keep local + VPS env contracts identical (`.env` parity)
- Enforce allowlists in production chat channels
- Enable correlation ID propagation by default
- Keep toolset minimal in prod (no broad web/shell unless explicitly needed)
- Start with scheduled summaries + on-demand triage; add autonomous loops gradually
