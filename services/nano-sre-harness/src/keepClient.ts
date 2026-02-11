export type KeepAlertQueryResponse = {
  results?: Array<Record<string, any>>;
  [k: string]: any;
};

export class KeepClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private async req(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Keep ${method} ${path} failed: ${res.status} ${txt}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.text();
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthcheck`, {
        headers: { "x-api-key": this.apiKey },
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async queryAlerts(cel: string, limit: number, offset: number): Promise<KeepAlertQueryResponse> {
    return await this.req("POST", "/alerts/query", { cel, limit, offset });
  }

  async getAlert(fingerprint: string): Promise<Record<string, any>> {
    return await this.req("GET", `/alerts/${encodeURIComponent(fingerprint)}`);
  }

  async enrichAlert(fingerprint: string, enrichments: Record<string, string>): Promise<any> {
    return await this.req("POST", "/alerts/enrich", { fingerprint, enrichments });
  }

  async invokeProvider(providerId: string, method: string, payload: Record<string, any>): Promise<any> {
    return await this.req(
      "POST",
      `/providers/${encodeURIComponent(providerId)}/invoke/${encodeURIComponent(method)}`,
      payload,
    );
  }

  async lokiQueryRange(providerId: string, query: string, since: string, limit: number): Promise<any> {
    return await this.invokeProvider(providerId, "_query", {
      queryType: "query_range",
      query,
      since,
      limit: String(limit),
    });
  }
}
