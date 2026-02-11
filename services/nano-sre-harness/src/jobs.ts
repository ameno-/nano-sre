import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type JobStatus = "queued" | "running" | "done" | "error";
export type WorkstreamStatus = "open" | "closed";

export type JobEvent = {
  ts: string;
  phase: string;
  message: string;
  correlation_id: string;
  data?: any;
};

export type Job = {
  id: string;
  kind: string;
  status: JobStatus;
  correlation_id: string;
  workstream_id?: string;
  idempotency_key?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  result?: any;
  input?: any;
  events: JobEvent[];
};

export type Workstream = {
  id: string;
  status: WorkstreamStatus;
  correlation_id: string;
  created_at: string;
  closed_at?: string;
  metadata?: any;
  job_ids: string[];
};

type PersistedState = {
  version: number;
  jobs: Job[];
  workstreams: Workstream[];
  triage_idempotency: Record<string, string>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function coerceObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  return {};
}

export class JobStore {
  private jobs: Map<string, Job> = new Map();
  private workstreams: Map<string, Workstream> = new Map();
  private triageIdempotency: Map<string, string> = new Map();
  private storePath: string;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(params?: { storePath?: string }) {
    this.storePath = params?.storePath || "/tmp/pi-sre-store.json";
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.storePath)) return;

    const raw = readFileSync(this.storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    const workstreams = Array.isArray(parsed.workstreams) ? parsed.workstreams : [];
    const triage = coerceObject(parsed.triage_idempotency);

    this.jobs = new Map(jobs.map((j) => [String(j.id), j]));
    this.workstreams = new Map(workstreams.map((w) => [String(w.id), w]));
    this.triageIdempotency = new Map(
      Object.entries(triage)
        .filter((entry) => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([k, v]) => [k, String(v)]),
    );
  }

  private snapshot(): PersistedState {
    return {
      version: 1,
      jobs: Array.from(this.jobs.values()),
      workstreams: Array.from(this.workstreams.values()),
      triage_idempotency: Object.fromEntries(this.triageIdempotency),
    };
  }

  private queuePersist(): Promise<void> {
    this.persistChain = this.persistChain
      .then(async () => {
        const dir = path.dirname(this.storePath);
        await mkdir(dir, { recursive: true });
        const tmp = `${this.storePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await writeFile(tmp, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
        await rename(tmp, this.storePath);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("persist_failed", e);
      });
    return this.persistChain;
  }

  async openWorkstream(params: { workstreamId?: string; correlationId: string; metadata?: any }): Promise<Workstream> {
    const id = params.workstreamId?.trim() || randomId("ws");
    const existing = this.workstreams.get(id);
    if (existing) return existing;

    const ws: Workstream = {
      id,
      status: "open",
      correlation_id: params.correlationId,
      created_at: nowIso(),
      metadata: params.metadata,
      job_ids: [],
    };
    this.workstreams.set(ws.id, ws);
    await this.queuePersist();
    return ws;
  }

  async getWorkstream(id: string): Promise<Workstream | undefined> {
    return this.workstreams.get(id);
  }

  async closeWorkstream(id: string): Promise<Workstream | undefined> {
    const ws = this.workstreams.get(id);
    if (!ws) return undefined;
    if (ws.status === "closed") return ws;
    ws.status = "closed";
    ws.closed_at = nowIso();
    await this.queuePersist();
    return ws;
  }

  async listJobsByWorkstream(workstreamId: string): Promise<Job[]> {
    const ws = this.workstreams.get(workstreamId);
    if (!ws) return [];
    const jobs = ws.job_ids.map((id) => this.jobs.get(id)).filter((j): j is Job => Boolean(j));
    jobs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return jobs;
  }

  async create(
    kind: string,
    input: any,
    params?: { correlationId: string; workstreamId?: string; idempotencyKey?: string },
  ): Promise<{ job: Job; idempotentReplay: boolean }> {
    const correlationId = params?.correlationId || randomId("corr");
    const idempotencyKey = params?.idempotencyKey;
    if (idempotencyKey) {
      const existingJobId = this.triageIdempotency.get(idempotencyKey);
      if (existingJobId) {
        const existing = this.jobs.get(existingJobId);
        if (existing) {
          this.appendEvent(existing.id, {
            phase: "idempotent_replay",
            message: "Returning existing triage job for idempotent submission",
            correlation_id: correlationId,
            data: { idempotency_key: idempotencyKey },
          });
          return { job: existing, idempotentReplay: true };
        }
      }
    }

    if (params?.workstreamId) {
      const ws = this.workstreams.get(params.workstreamId);
      if (!ws) throw new Error(`workstream_not_found:${params.workstreamId}`);
      if (ws.status !== "open") throw new Error(`workstream_closed:${params.workstreamId}`);
    }

    const id = randomId("job");
    const job: Job = {
      id,
      kind,
      input,
      status: "queued",
      correlation_id: correlationId,
      workstream_id: params?.workstreamId,
      idempotency_key: idempotencyKey,
      created_at: nowIso(),
      events: [
        {
          ts: nowIso(),
          phase: "job_created",
          message: `Job created (${kind})`,
          correlation_id: correlationId,
        },
      ],
    };
    this.jobs.set(id, job);

    if (params?.workstreamId) {
      const ws = this.workstreams.get(params.workstreamId);
      if (ws) ws.job_ids.push(job.id);
    }
    if (idempotencyKey) this.triageIdempotency.set(idempotencyKey, job.id);

    await this.queuePersist();
    return { job, idempotentReplay: false };
  }

  async get(id: string): Promise<Job | undefined> {
    return this.jobs.get(id);
  }

  appendEvent(id: string, ev: Omit<JobEvent, "ts"> & { ts?: string }): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push({
      ts: ev.ts || nowIso(),
      phase: ev.phase,
      message: ev.message,
      correlation_id: ev.correlation_id || job.correlation_id,
      data: ev.data,
    });
    void this.queuePersist();
  }

  eventsSince(id: string, offset: number): { events: JobEvent[]; nextOffset: number } {
    const job = this.jobs.get(id);
    if (!job) return { events: [], nextOffset: offset };
    const start = Math.max(0, Number(offset || 0));
    const events = job.events.slice(start);
    return { events, nextOffset: start + events.length };
  }

  async list(limit: number): Promise<Job[]> {
    const all = Array.from(this.jobs.values());
    all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return all.slice(0, limit);
  }

  runInBackground(job: Job, fn: () => Promise<any>): void {
    job.status = "running";
    job.started_at = nowIso();
    job.events.push({
      ts: nowIso(),
      phase: "job_started",
      message: "Job started",
      correlation_id: job.correlation_id,
    });
    void this.queuePersist();

    fn()
      .then((result) => {
        job.status = "done";
        job.finished_at = nowIso();
        if (result && typeof result === "object") {
          job.result = { ...result, correlation_id: (result as any).correlation_id || job.correlation_id };
        } else {
          job.result = { value: result, correlation_id: job.correlation_id };
        }
        job.events.push({
          ts: nowIso(),
          phase: "job_done",
          message: "Job finished",
          correlation_id: job.correlation_id,
        });
        void this.queuePersist();
      })
      .catch((e: any) => {
        job.status = "error";
        job.finished_at = nowIso();
        job.error = String(e?.message || e);
        job.events.push({
          ts: nowIso(),
          phase: "job_error",
          message: "Job failed",
          correlation_id: job.correlation_id,
          data: { error: job.error },
        });
        void this.queuePersist();
      });
  }
}
