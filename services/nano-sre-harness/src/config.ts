export type AppConfig = {
  port: number;
  keepBaseUrl: string;
  keepApiKey: string;
  keepLokiProviderId: string;
  openrouterApiKey: string;
  piProvider: string;
  piModelId: string;
  piThinkingLevel: "off" | "low" | "medium" | "high";
  piServiceToken: string;
  storePath: string;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function loadConfig(): AppConfig {
  const provider = process.env.NANO_SRE_PROVIDER || process.env.PI_PROVIDER || "openrouter";
  const modelId =
    process.env.NANO_SRE_MODEL_ID || process.env.PI_MODEL_ID || "google/gemini-3-flash-preview";
  const thinking =
    (process.env.NANO_SRE_THINKING_LEVEL || process.env.PI_THINKING_LEVEL || "high") as
      | "off"
      | "low"
      | "medium"
      | "high";
  const serviceToken = process.env.NANO_SRE_SERVICE_TOKEN || process.env.PI_SERVICE_TOKEN || "";
  const storePath = process.env.NANO_SRE_STORE_PATH || process.env.PI_STORE_PATH || "/tmp/nano-sre-store.json";

  return {
    port: Number(process.env.PORT || "8790"),
    keepBaseUrl: (process.env.KEEP_BASE_URL || "http://keep-backend:8080").replace(/\/+$/, ""),
    keepApiKey: process.env.KEEP_X_API_KEY || "local-dev",
    keepLokiProviderId: process.env.KEEP_LOKI_PROVIDER_ID || "",
    openrouterApiKey: mustEnv("OPENROUTER_API_KEY"),
    piProvider: provider,
    piModelId: modelId,
    piThinkingLevel: thinking,
    piServiceToken: serviceToken,
    storePath,
  };
}
