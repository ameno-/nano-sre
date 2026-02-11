import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { KeepClient } from "./keepClient.js";
import { JobStore } from "./jobs.js";
import { TriageEngine } from "./engine.js";

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

type TriageAlertRequest = {
  alert_id: string;
  screenshot_b64?: string;
  screenshot_mime?: string;
  extra_context?: string;
  loki_query?: string;
  loki_since?: string;
  debug?: boolean;
  workstream_id?: string;
};

type OpenWorkstreamRequest = {
  workstream_id?: string;
  metadata?: any;
};

type QueryJobRequest = {
  query?: string;
  params?: Record<string, any>;
  debug?: boolean;
};

function splitModel(provider: string, modelId: string): { provider: string; id: string } {
  const s = `${provider}/${modelId}`;
  if (s.includes("/")) {
    const [p, ...rest] = s.split("/");
    return { provider: p, id: rest.join("/") };
  }
  return { provider, id: modelId };
}

function firstHeaderValue(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return undefined;
}

function parseBearerToken(authorization: unknown): string | undefined {
  const header = firstHeaderValue(authorization);
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || undefined;
}

function resolveCorrelationId(value: unknown): string {
  const cid = firstHeaderValue(value)?.trim();
  return cid || randomUUID();
}

function triageIdempotencyKey(params: {
  workstreamId: string;
  alertId: string;
  lokiQuery: string;
  lokiSince: string;
  modelRef: string;
}): string {
  const raw = [params.workstreamId, params.alertId, params.lokiQuery, params.lokiSince, params.modelRef].join("\u001f");
  return createHash("sha256").update(raw).digest("hex");
}

async function main() {
  const cfg = loadConfig();

  // Pi discovers API keys from env/auth.json. Ensure OPENROUTER_API_KEY is set.
  // We keep this explicit check so failures are obvious.
  if (!cfg.openrouterApiKey) throw new Error("OPENROUTER_API_KEY missing");

  const keep = new KeepClient(cfg.keepBaseUrl, cfg.keepApiKey);
  const engine = new TriageEngine({ keep, keepLokiProviderId: cfg.keepLokiProviderId });
  const jobs = new JobStore({ storePath: cfg.storePath });

  const fastify = Fastify({ logger: true });

  fastify.addHook("onRequest", async (req, reply) => {
    const correlationId = resolveCorrelationId(req.headers["x-correlation-id"]);
    req.correlationId = correlationId;
    reply.header("x-correlation-id", correlationId);

    if (!cfg.piServiceToken) return;
    const bearer = parseBearerToken(req.headers.authorization);
    const headerToken = firstHeaderValue(req.headers["x-service-token"])?.trim();
    const authorized = bearer === cfg.piServiceToken || headerToken === cfg.piServiceToken;
    if (!authorized) {
      return await reply.code(401).send({ detail: "unauthorized", correlation_id: correlationId });
    }
  });

  const model = splitModel(cfg.piProvider, cfg.piModelId);
  const modelRef = `${model.provider}/${model.id}`;

  fastify.get("/healthz", async () => {
    return await engine.health({ provider: model.provider, id: model.id });
  });

  fastify.post("/v1/workstreams/open", async (req) => {
    const body = (req.body || {}) as OpenWorkstreamRequest;
    const ws = await jobs.openWorkstream({
      workstreamId: body.workstream_id,
      correlationId: req.correlationId,
      metadata: body.metadata,
    });
    return {
      workstream_id: ws.id,
      status: ws.status,
      created_at: ws.created_at,
      closed_at: ws.closed_at || null,
      correlation_id: req.correlationId,
    };
  });

  fastify.post("/v1/workstreams/:workstream_id/jobs/triage", async (req, reply) => {
    const workstreamId = (req.params as any)?.workstream_id as string;
    const ws = await jobs.getWorkstream(workstreamId);
    if (!ws) return reply.code(404).send({ detail: "workstream not found", correlation_id: req.correlationId });
    if (ws.status !== "open") return reply.code(409).send({ detail: "workstream closed", correlation_id: req.correlationId });

    const body = req.body as TriageAlertRequest;
    if (!body?.alert_id) return reply.code(400).send({ detail: "alert_id is required", correlation_id: req.correlationId });
    const lokiSince = body.loki_since || "30m";
    const idempotencyKey = triageIdempotencyKey({
      workstreamId,
      alertId: body.alert_id,
      lokiQuery: body.loki_query || "",
      lokiSince,
      modelRef,
    });

    const { job, idempotentReplay } = await jobs.create("triage_alert", body, {
      correlationId: req.correlationId,
      workstreamId,
      idempotencyKey,
    });

    if (!idempotentReplay) {
      jobs.runInBackground(job, async () => {
        return await engine.triageAlert({
          alertId: body.alert_id,
          model: { provider: model.provider, id: model.id, thinkingLevel: cfg.piThinkingLevel },
          screenshotB64: body.screenshot_b64,
          screenshotMime: body.screenshot_mime,
          extraContext: body.extra_context || "",
          lokiQuery: body.loki_query,
          lokiSince,
          debug: Boolean(body.debug),
          onProgress: (ev) =>
            jobs.appendEvent(job.id, {
              phase: ev.phase,
              message: ev.message,
              data: ev.data,
              correlation_id: req.correlationId,
            }),
        });
      });
    }

    return {
      workstream_id: workstreamId,
      job_id: job.id,
      status: job.status,
      idempotency_key: idempotencyKey,
      idempotent_replay: idempotentReplay,
      correlation_id: req.correlationId,
    };
  });

  fastify.post("/v1/workstreams/:workstream_id/jobs/query", async (req, reply) => {
    const workstreamId = (req.params as any)?.workstream_id as string;
    const ws = await jobs.getWorkstream(workstreamId);
    if (!ws) return reply.code(404).send({ detail: "workstream not found", correlation_id: req.correlationId });
    if (ws.status !== "open") return reply.code(409).send({ detail: "workstream closed", correlation_id: req.correlationId });

    const body = (req.body || {}) as QueryJobRequest;
    const { job } = await jobs.create("query_task", body, {
      correlationId: req.correlationId,
      workstreamId,
    });

    jobs.runInBackground(job, async () => {
      jobs.appendEvent(job.id, {
        phase: "query_start",
        message: "Starting passthrough query scaffold",
        data: { query: body.query || "", params: body.params || null },
        correlation_id: req.correlationId,
      });

      return {
        workstream_id: workstreamId,
        query: body.query || "",
        params: body.params || null,
        debug: Boolean(body.debug),
        note: "passthrough query scaffold executed",
        correlation_id: req.correlationId,
      };
    });

    return {
      workstream_id: workstreamId,
      job_id: job.id,
      status: job.status,
      correlation_id: req.correlationId,
    };
  });

  fastify.get("/v1/workstreams/:workstream_id", async (req, reply) => {
    const workstreamId = (req.params as any)?.workstream_id as string;
    const ws = await jobs.getWorkstream(workstreamId);
    if (!ws) return reply.code(404).send({ detail: "workstream not found", correlation_id: req.correlationId });
    const workstreamJobs = await jobs.listJobsByWorkstream(workstreamId);

    return {
      id: ws.id,
      status: ws.status,
      correlation_id: req.correlationId,
      created_at: ws.created_at,
      closed_at: ws.closed_at || null,
      metadata: ws.metadata || null,
      job_count: workstreamJobs.length,
      jobs: workstreamJobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        status: job.status,
        correlation_id: job.correlation_id,
        created_at: job.created_at,
        started_at: job.started_at,
        finished_at: job.finished_at,
      })),
    };
  });

  fastify.post("/v1/workstreams/:workstream_id/close", async (req, reply) => {
    const workstreamId = (req.params as any)?.workstream_id as string;
    const ws = await jobs.closeWorkstream(workstreamId);
    if (!ws) return reply.code(404).send({ detail: "workstream not found", correlation_id: req.correlationId });
    return {
      workstream_id: ws.id,
      status: ws.status,
      closed_at: ws.closed_at || null,
      correlation_id: req.correlationId,
    };
  });

  fastify.post("/v1/triage/alert", async (req, reply) => {
    const body = req.body as TriageAlertRequest;
    if (!body?.alert_id) return reply.code(400).send({ detail: "alert_id is required", correlation_id: req.correlationId });

    const result = await engine.triageAlert({
      alertId: body.alert_id,
      model: { provider: model.provider, id: model.id, thinkingLevel: cfg.piThinkingLevel },
      screenshotB64: body.screenshot_b64,
      screenshotMime: body.screenshot_mime,
      extraContext: body.extra_context || "",
      lokiQuery: body.loki_query,
      lokiSince: body.loki_since || "30m",
      debug: Boolean(body.debug),
    });

    return { ...result, correlation_id: req.correlationId };
  });

  fastify.post("/v1/jobs/triage/alert", async (req, reply) => {
    const body = req.body as TriageAlertRequest;
    if (!body?.alert_id) return reply.code(400).send({ detail: "alert_id is required", correlation_id: req.correlationId });

    const { job } = await jobs.create("triage_alert", body, {
      correlationId: req.correlationId,
      workstreamId: body.workstream_id,
    });

    jobs.runInBackground(job, async () => {
      return await engine.triageAlert({
        alertId: body.alert_id,
        model: { provider: model.provider, id: model.id, thinkingLevel: cfg.piThinkingLevel },
        screenshotB64: body.screenshot_b64,
        screenshotMime: body.screenshot_mime,
        extraContext: body.extra_context || "",
        lokiQuery: body.loki_query,
        lokiSince: body.loki_since || "30m",
        debug: Boolean(body.debug),
        onProgress: (ev) =>
          jobs.appendEvent(job.id, {
            phase: ev.phase,
            message: ev.message,
            data: ev.data,
            correlation_id: req.correlationId,
          }),
      });
    });

    return { job_id: job.id, status: job.status, correlation_id: req.correlationId };
  });

  fastify.get("/v1/jobs/:job_id/events", async (req, reply) => {
    const jobId = (req.params as any)?.job_id;
    const job = await jobs.get(jobId);
    if (!job) return reply.code(404).send({ detail: "job not found", correlation_id: req.correlationId });

    const offset = Number((req.query as any)?.offset || 0);
    const { events, nextOffset } = jobs.eventsSince(jobId, offset);
    return {
      id: job.id,
      status: job.status,
      correlation_id: req.correlationId,
      offset,
      next_offset: nextOffset,
      events,
    };
  });

  fastify.get("/v1/jobs/:job_id", async (req, reply) => {
    const jobId = (req.params as any)?.job_id;
    const job = await jobs.get(jobId);
    if (!job) return reply.code(404).send({ detail: "job not found", correlation_id: req.correlationId });

    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      correlation_id: job.correlation_id,
      workstream_id: job.workstream_id || null,
      idempotency_key: job.idempotency_key || null,
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      error: job.error,
      result: job.status === "done" ? job.result : null,
    };
  });

  fastify.get("/v1/jobs", async (req) => {
    const limit = Number((req.query as any)?.limit || 50);
    const list = await jobs.list(limit);
    return {
      count: list.length,
      correlation_id: req.correlationId,
      jobs: list.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        correlation_id: j.correlation_id,
        workstream_id: j.workstream_id || null,
        created_at: j.created_at,
        started_at: j.started_at,
        finished_at: j.finished_at,
      })),
    };
  });

  await fastify.listen({ host: "0.0.0.0", port: cfg.port });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
