import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";

export type TriageVerdict = {
  severity: "critical" | "high" | "warning" | "info" | "low";
  category: "infrastructure" | "application" | "network" | "security" | "config" | "unknown";
  root_cause_hypothesis: string;
  affected_services: string[];
  recommended_actions: string[];
  confidence: number;
  evidence_summary: string;
  suggested_runbook: string;
};

function systemPrompt(): string {
  return (
    "You are a senior Site Reliability Engineer performing production triage.\n" +
    "Return ONLY valid JSON with exactly these fields:\n" +
    '  "severity": "critical"|"high"|"warning"|"info"|"low"\n' +
    '  "category": "infrastructure"|"application"|"network"|"security"|"config"|"unknown"\n' +
    '  "root_cause_hypothesis": string\n' +
    '  "affected_services": string[]\n' +
    '  "recommended_actions": string[] (ordered, top 3 first)\n' +
    '  "confidence": number (0.0-1.0)\n' +
    '  "evidence_summary": string\n' +
    '  "suggested_runbook": string\n' +
    "Be terse, operational, and evidence-based. If evidence is insufficient, lower confidence and say what to fetch next.\n" +
    "Hard requirements: do not include markdown fences, headings, or any prose. Begin your response with { and end it with }."
  );
}

function parseJson(text: string): any {
  let t = (text || "").trim();

  // Strip common markdown fences.
  if (t.startsWith("```")) {
    // ```json\n{...}
    const firstNl = t.indexOf("\n");
    if (firstNl >= 0) t = t.slice(firstNl + 1);
  }
  if (t.endsWith("```")) t = t.slice(0, -3);
  t = t.trim();

  // First attempt: parse as-is.
  try {
    return JSON.parse(t);
  } catch {
    // Second attempt: recover the first JSON object from mixed text.
    const i = t.indexOf("{");
    const j = t.lastIndexOf("}");
    if (i >= 0 && j > i) {
      const candidate = t.slice(i, j + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // fallthrough
      }
    }
    return { _raw: t };
  }
}

export type PiSessionEvent = {
  ts: string;
  type: string;
  data?: any;
};

function extractAssistantText(messages: any[]): string {
  // Best-effort extraction across pi-agent message shapes.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== "assistant") continue;

    const c = (m.content ?? m.text ?? m.message ?? "") as any;
    if (typeof c === "string") return c;

    if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const p of c) {
        if (!p) continue;
        if (typeof p === "string") parts.push(p);
        if (typeof p.text === "string") parts.push(p.text);
      }
      if (parts.length) return parts.join("");
    }
  }

  return "";
}

export class PiSREHarness {
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;

  constructor(authPath = "/tmp/pi-agent/auth.json") {
    this.authStorage = new AuthStorage(authPath);
    this.modelRegistry = new ModelRegistry(this.authStorage);
  }

  async triage(params: {
    provider: string;
    modelId: string;
    thinkingLevel: "off" | "low" | "medium" | "high";
    prompt: string;
    screenshotB64?: string;
    screenshotMime?: string;
    onEvent?: (ev: PiSessionEvent) => void;
  }): Promise<{ verdict: TriageVerdict; assistant_text: string; system_prompt: string }> {
    // Resolve model.
    let model: any = getModel(params.provider as any, params.modelId);
    if (!model) {
      // Some registries use the provider name as given and the raw model id.
      model = this.modelRegistry.find(params.provider, params.modelId) || undefined;
    }
    if (!model) {
      // As a last resort, scan available models (requires valid API key).
      const available: any[] = await this.modelRegistry.getAvailable();
      const wanted = `${params.provider}/${params.modelId}`.toLowerCase();
      model = available.find((m: any) => `${m.provider}/${m.id}`.toLowerCase() === wanted);
      if (!model) {
        model = available.find((m: any) => `${m.provider}/${m.id}`.toLowerCase().includes(params.modelId.toLowerCase()));
      }
    }
    if (!model) throw new Error(`Model not found: ${params.provider}/${params.modelId}`);

    const sys = systemPrompt();
    const resourceLoader: ResourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => sys,
      getAppendSystemPrompt: () => [],
      getPathMetadata: () => new Map(),
      extendResources: () => {},
      reload: async () => {},
    };

    const { session } = await createAgentSession({
      cwd: "/tmp",
      agentDir: "/tmp/pi-agent",
      model,
      thinkingLevel: params.thinkingLevel,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader,
      tools: [], // hard safety: no shell, no file IO
      sessionManager: SessionManager.inMemory(),
    });

    try {
      if (params.onEvent) {
        session.subscribe((event: any) => {
          // Event shapes are stable enough for logging.
          try {
            params.onEvent?.({
              ts: new Date().toISOString(),
              type: String(event?.type || "unknown"),
              data: event,
            });
          } catch {
            // ignore
          }
        });
      }

      const promptOpts: any = {};
      if (params.screenshotB64) {
        promptOpts.images = [
          {
            type: "image",
            source: {
              type: "base64",
              mediaType: params.screenshotMime || "image/png",
              data: params.screenshotB64,
            },
          },
        ];
      }

      await session.prompt(params.prompt, promptOpts);
      const text = extractAssistantText((session as any).state?.messages || (session as any).messages || []);
      const raw = parseJson(text);

      const verdict: TriageVerdict = {
        severity: raw.severity || "info",
        category: raw.category || "unknown",
        root_cause_hypothesis: raw.root_cause_hypothesis || "",
        affected_services: Array.isArray(raw.affected_services) ? raw.affected_services : [],
        recommended_actions: Array.isArray(raw.recommended_actions) ? raw.recommended_actions : [],
        confidence: Number(raw.confidence || 0) || 0,
        evidence_summary: raw.evidence_summary || "",
        suggested_runbook: raw.suggested_runbook || "",
      };

      return { verdict, assistant_text: text, system_prompt: sys };
    } finally {
      session.dispose();
    }
  }
}
