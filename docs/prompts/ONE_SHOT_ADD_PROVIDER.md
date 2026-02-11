# One-shot Prompt: Add Provider (Loki-style)

Copy this prompt into your coding agent to add a new provider cleanly.

---

You are implementing a new evidence provider in `nano-sre`.

## Goal
Add `<PROVIDER_NAME>` to the existing triage pipeline by following the Loki implementation pattern exactly, without breaking current workflows.

## Repository
`~/dev/nano-sre`

## Constraints
- Preserve current Loki behavior and Nanobot workflows.
- Keep integration optional via env vars.
- No secrets in code or docs.
- Keep triage output contract unchanged:
  - plain text summary
  - HTML report artifact
  - correlation_id
- Keep incremental progress updates working.

## Files to update

1. `services/nano-sre-harness/src/config.ts`
- Add config fields for `<PROVIDER_NAME>` provider ID and query defaults.
- Env var naming:
  - `KEEP_<PROVIDER_UPPER>_PROVIDER_ID`
  - optional `NANO_SRE_<PROVIDER_UPPER>_*` tuning vars
- Preserve fallback compatibility for existing env vars.

2. `services/nano-sre-harness/src/keepClient.ts`
- Add a typed helper for invoking provider method through Keep:
  - re-use `invokeProvider(providerId, method, payload)`
  - create `<providerName>Query(...)` helper similar to `lokiQueryRange(...)`

3. `services/nano-sre-harness/src/engine.ts`
- Add default query builder using alert labels/service context.
- Add evidence render/normalize function.
- In `triageAlert(...)`, execute provider query if configured.
- Emit progress event phase: `<provider_name>_query`.
- Add `<provider_name>` metadata to debug payload.
- Merge evidence text into prompt in the same way Loki evidence is merged.

4. `docker-compose.yml`
- Add env var passthrough for new provider ID/settings.

5. `.env.example`
- Add placeholder vars for new provider.

6. `README.md`
- Add brief setup instructions for provider ID and verification command.

7. `docs/INITIAL_VALIDATION.md`
- Add a short validation section for the new provider.

## Keep/Nanobot workflow requirements

- Do NOT create a separate triage flow if this provider is supplemental evidence.
- Existing Nanobot tools should continue to work:
  - `sre_triage_alert`
  - `sre_triage_alert_with_updates`
- Ensure progress updates include the new provider phase before `pi_start` when query runs.

## Acceptance criteria

1. `npm run build` passes in `services/nano-sre-harness`.
2. `docker compose config --no-interpolate` passes.
3. Keep provider invoke endpoint works with sample query payload.
4. End-to-end triage shows:
- progress phase for `<provider_name>_query`
- final summary + HTML report path
- correlation_id present
5. Existing Loki-backed triage still works unchanged.

## Output format

Return:
1. summary of changes
2. exact files changed
3. exact verification commands and key output lines
4. any follow-ups

---

Tip: use the Loki implementation in `keepClient.ts` and `engine.ts` as the canonical template for this integration.
