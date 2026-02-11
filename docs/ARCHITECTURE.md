# nano-sre Architecture

## Service roles

- **Nanobot**
  - Role: secretary/orchestrator
  - Responsibilities: channel IO (Telegram), progress messaging, user profile adaptation, invoking harness tools
  - Why it matters: keeps operator communication tight and continuous while long triage runs in background

- **nano-sre-harness (Pi Agent SDK)**
  - Role: high-power triage engine
  - Responsibilities: fetch Keep alert, query Loki via Keep provider, run LLM synthesis, emit structured verdict, stream events
  - Why it matters: isolates complex reasoning and model evolution from chat UX

- **Keep**
  - Role: persistence + aggregation platform
  - Responsibilities: ingest provider alerts, expose alert/query APIs, enrich alerts with verdict fields
  - Why it matters: unified incident history and provider abstraction

- **External providers (read-only)**
  - Examples: Sentry, Grafana/Loki, email/webhooks, cloud telemetry
  - Why it matters: source signal for triage

## Service map

```mermaid
graph TD
  U[Founder / Ops Team] -->|Telegram| N[Nanobot\nSecretary UX]
  N -->|Tool call: sre_triage_alert_with_updates| H[nano-sre-harness\nPi Agent SDK]
  H -->|Get alert / enrich alert| K[Keep API]
  H -->|Invoke Loki provider query| K
  K -->|Provider credentials + query proxy| L[Grafana Loki]
  K -->|Ingest alerts| S[Sentry]
  N -->|Final summary + report attachment| U

  subgraph Storage
    KS[(Keep DB)]
    HS[(Harness job/workstream store)]
    NS[(Nanobot workspace: reports/traces)]
  end

  K --- KS
  H --- HS
  N --- NS
```

## End-to-end triage sequence

```mermaid
sequenceDiagram
  participant User as Telegram User
  participant Nano as Nanobot
  participant Harness as nano-sre-harness
  participant Keep as Keep API
  participant Loki as Grafana Loki

  User->>Nano: "triage alert 7240220778"
  Nano->>Harness: POST /v1/jobs/triage/alert (corr-id)
  Harness-->>Nano: job_id + correlation_id
  Nano-->>User: progress: triage started

  Harness->>Keep: GET alert by id/fingerprint
  Keep-->>Harness: alert payload

  Harness->>Keep: POST providers/{loki}/invoke/_query
  Keep->>Loki: LogQL query
  Loki-->>Keep: log result
  Keep-->>Harness: normalized log result

  Harness->>Harness: Pi session (Gemini via OpenRouter)
  Harness-->>Nano: events stream (/events)
  Nano-->>User: progress checkpoints

  Harness->>Keep: enrich alert with triage verdict fields
  Harness-->>Nano: final verdict + debug payload
  Nano-->>User: summary + HTML report attachment
```

## Incremental updates flow

```mermaid
sequenceDiagram
  participant Nano as Nanobot Tool
  participant Harness as nano-sre-harness
  participant TG as Telegram

  Nano->>Harness: start triage job
  loop poll events
    Nano->>Harness: GET /v1/jobs/{id}/events?offset=n
    Harness-->>Nano: new events + next_offset
    Nano->>TG: progress message (phase-based)
  end
  Nano->>Harness: GET /v1/jobs/{id}
  Harness-->>Nano: done + verdict + debug
  Nano->>TG: final summary + HTML artifact
```

## Data contracts

- **Correlation ID**
  - Propagated via `x-correlation-id`
  - Returned by harness APIs
  - Included in final user-visible output

- **Verdict schema**
  - `severity`, `category`, `root_cause_hypothesis`, `affected_services`, `recommended_actions`, `confidence`, `evidence_summary`, `suggested_runbook`

- **Artifacts**
  - `summary_text`: concise operator message
  - `report_path`: HTML report for async review/handoff
  - `debug`: model/prompt/event metadata (optional)

## Why this works for solo founders and small teams

- Cuts context switching by centralizing incidents in one chat workflow
- Reduces panic during incidents via progressive transparency
- Produces durable artifacts for async collaboration
- Scales from one person to a small team without new platform complexity
