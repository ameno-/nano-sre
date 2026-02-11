# Initial Validation Notes

## Provider and data path validation

- Sentry provider installed and scope checks passed (`event:read`, `project:read`, `project:write`).
- Grafana provider installed and validated for alert scopes.
- Loki connectivity validated by label query (`service_name` values returned successfully).
- Keep provider invoke path validated for Loki queries.

## Harness validation

- `GET /healthz` returned healthy status with configured model.
- Workstream open/close behavior validated.
- Triage job lifecycle validated:
  - queued -> running -> done
  - event streaming endpoint returned phase transitions
- Correlation IDs propagated from request to response and event stream.
- Idempotent replay behavior validated for duplicate workstream triage submissions.

## Nanobot orchestration validation

- Harness tools invoked successfully from Nanobot.
- Incremental progress updates emitted during active triage.
- Final result included concise summary + HTML report artifact path.
- Debug artifacts captured:
  - effective tool args
  - harness model info
  - triage prompt/system prompt snapshots

## Gemini SDK integration challenges encountered

- Direct provider path showed inconsistent token/model behavior and endpoint confusion.
- Errors like model-not-found / provider mismatch slowed local iteration.
- Resolution: route Gemini via OpenRouter through Pi Agent SDK harness for stable model abstraction and faster iteration.

## Outcome

The final pipeline is stable for local testing and structurally ready for VPS deployment with minimal env/config changes.
