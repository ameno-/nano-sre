import { KeepClient } from "./keepClient.js";
import { PiSREHarness, type TriageVerdict, type PiSessionEvent } from "./piHarness.js";

export class TriageEngine {
  private keep: KeepClient;
  private pi: PiSREHarness;
  private keepLokiProviderId: string;

  constructor(params: { keep: KeepClient; keepLokiProviderId: string }) {
    this.keep = params.keep;
    this.pi = new PiSREHarness();
    this.keepLokiProviderId = params.keepLokiProviderId || "";
  }

  async health(model: { provider: string; id: string }): Promise<any> {
    return {
      keep: await this.keep.health(),
      model: `${model.provider}/${model.id}`,
    };
  }

  private defaultLokiQuery(alert: Record<string, any>): string {
    const labels = (alert.labels || {}) as Record<string, any>;
    const service =
      String(alert.service || "") ||
      String(labels.service_name || "") ||
      String(labels.service || "") ||
      String(labels.app || "");

    if (!service) return '{service_name=~"backend|nginx|integrations/node_exporter"} |= "ERROR"';
    return `{service_name="${service}"} |= "ERROR"`;
  }

  private renderLokiForPrompt(resp: any, limitLines = 250): string {
    const lines: string[] = [];

    if (resp && typeof resp === "object") {
      const data = (resp.data ?? resp.result ?? resp) as any;
      if (data && typeof data === "object" && Array.isArray(data.result)) {
        for (const stream of data.result) {
          for (const v of stream?.values || []) {
            if (Array.isArray(v) && v.length >= 2) lines.push(String(v[1]));
          }
        }
      } else if (Array.isArray(data)) {
        for (const item of data) lines.push(String(item));
      }
    } else {
      lines.push(String(resp ?? ""));
    }

    return lines.slice(-limitLines).join("\n");
  }

  private buildPrompt(params: {
    title: string;
    description: string;
    severity: string;
    source: string;
    labels: Record<string, any>;
    extraContext: string;
    logEvidence: string;
  }): string {
    const chunks: string[] = [];
    chunks.push(`ALERT_TITLE: ${params.title}`);
    chunks.push(`ALERT_SEVERITY: ${params.severity}`);
    chunks.push(`SOURCE: ${params.source}`);
    chunks.push(`DESCRIPTION: ${params.description}`);
    chunks.push(`LABELS_JSON: ${JSON.stringify(params.labels || {})}`);
    if (params.extraContext) chunks.push(`EXTRA_CONTEXT: ${params.extraContext}`);
    if (params.logEvidence) {
      chunks.push("LOG_EVIDENCE:\n```");
      chunks.push(params.logEvidence.slice(0, 16000));
      chunks.push("```");
    }
    return chunks.join("\n");
  }

  private lokiLineCount(resp: any): number {
    let n = 0;
    if (resp && typeof resp === "object") {
      const data = (resp.data ?? resp.result ?? resp) as any;
      if (data && typeof data === "object" && Array.isArray(data.result)) {
        for (const stream of data.result) n += (stream?.values || []).length;
      }
    }
    return n;
  }

  async triageAlert(params: {
    alertId: string;
    model: { provider: string; id: string; thinkingLevel: "off" | "low" | "medium" | "high" };
    screenshotB64?: string;
    screenshotMime?: string;
    extraContext: string;
    lokiQuery?: string;
    lokiSince: string;
    debug?: boolean;
    onProgress?: (ev: { phase: string; message: string; data?: any }) => void;
  }): Promise<{
    alert_ref: string;
    alert_fingerprint: string;
    alert: any;
    verdict: TriageVerdict;
    debug?: any;
  }> {
    let fingerprint = params.alertId;
    let alert: any;

    try {
      params.onProgress?.({ phase: "keep_fetch", message: "Fetching alert from Keep", data: { alert_id: params.alertId } });
      alert = await this.keep.getAlert(fingerprint);
    } catch (e) {
      // Fallback: resolve UUID-ish id to fingerprint via CEL.
      params.onProgress?.({ phase: "keep_fetch_fallback", message: "Resolving Keep UUID to fingerprint", data: { alert_id: params.alertId } });
      const q = await this.keep.queryAlerts(`id == "${params.alertId}"`, 1, 0);
      const first = (q.results || [])[0] as any;
      if (first?.fingerprint) {
        fingerprint = String(first.fingerprint);
        alert = await this.keep.getAlert(fingerprint);
      } else {
        throw e;
      }
    }

    let logEvidence = "";
    let lokiMeta: any = null;
    if (this.keepLokiProviderId && (params.lokiQuery || this.defaultLokiQuery(alert))) {
      const q = params.lokiQuery || this.defaultLokiQuery(alert);
      params.onProgress?.({
        phase: "loki_query",
        message: "Querying Loki via Keep provider",
        data: { provider_id: this.keepLokiProviderId, since: params.lokiSince, query: q },
      });
      try {
        const lokiResp = await this.keep.lokiQueryRange(this.keepLokiProviderId, q, params.lokiSince, 200);
        lokiMeta = { query: q, since: params.lokiSince, lines: this.lokiLineCount(lokiResp) };
        logEvidence = this.renderLokiForPrompt(lokiResp, 250);
      } catch {
        logEvidence = "";
      }
    }

    const prompt = this.buildPrompt({
      title: String(alert.name || alert.title || params.alertId),
      description: String(alert.description || ""),
      severity: String(alert.severity || ""),
      source: String(alert.source || ""),
      labels: (alert.labels || {}) as Record<string, any>,
      extraContext: params.extraContext || "",
      logEvidence,
    });

    params.onProgress?.({
      phase: "pi_start",
      message: "Calling Pi agent (OpenRouter) for synthesis",
      data: { provider: params.model.provider, model: params.model.id, thinking: params.model.thinkingLevel },
    });

    const piEvents: PiSessionEvent[] = [];
    const piResult = await this.pi.triage({
      provider: params.model.provider,
      modelId: params.model.id,
      thinkingLevel: params.model.thinkingLevel,
      prompt,
      screenshotB64: params.screenshotB64,
      screenshotMime: params.screenshotMime,
      onEvent: (ev) => {
        piEvents.push(ev);
        // Avoid noisy deltas; keep lifecycle only.
        if (ev.type in { agent_start: 1, agent_end: 1, turn_start: 1, turn_end: 1, message_start: 1, message_end: 1 }) {
          params.onProgress?.({ phase: "pi_event", message: `pi:${ev.type}`, data: { type: ev.type } });
        }
      },
    });
    const verdict = piResult.verdict;

    // Best-effort enrichment.
    try {
      const v = {
        "triage.verdict_json": JSON.stringify(verdict),
        "triage.severity": String(verdict.severity || ""),
        "triage.category": String(verdict.category || ""),
        "triage.confidence": String(verdict.confidence || 0),
        "triage.triaged_by": "pi-sre",
        "triage.triaged_at": new Date().toISOString(),
      };
      await this.keep.enrichAlert(fingerprint, v);
    } catch {
      // ignore
    }

    const debug = params.debug
      ? {
          model: { provider: params.model.provider, id: params.model.id, thinkingLevel: params.model.thinkingLevel },
          system_prompt: piResult.system_prompt,
          prompt,
          loki: lokiMeta,
          assistant_text: piResult.assistant_text,
          pi_event_types: piEvents.map((e) => e.type),
        }
      : undefined;

    return {
      alert_ref: params.alertId,
      alert_fingerprint: fingerprint,
      alert,
      verdict,
      debug,
    };
  }
}
