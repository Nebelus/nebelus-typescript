/**
 * Nebelus Construction API — TypeScript client.
 *
 * A thin, typed wrapper over the same universal construction service behind the
 * visual builders and the MCP facade. Agents are always born as drafts;
 * publishing (`deploy`) needs the `api.construction.deploy` scope AND the org's
 * programmatic-deploy opt-in.
 *
 * For fully-typed request/response bodies, generate `schema.d.ts` from the live
 * OpenAPI document (`npm run gen:types`) and layer it over this client — this
 * hand-written surface covers the core workflow and stays dependency-free.
 */

export interface NebelusClientOptions {
  /** Organization API key (Bearer). Needs api.construction.read|write; deploy needs api.construction.deploy. */
  apiKey: string;
  /** Region base URL. EU: https://api.nebelus.ai (default). KSA: https://api.ksa.nebelus.ai */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface Agent {
  id: string;
  name: string;
  status: string;
  model_id?: string;
  system_message?: string;
  pattern_type?: string;
  pattern_config?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Wiring {
  agent_id: string;
  api_base: string;
  region: string | null;
  rest: { url: string; method: string; auth: string; [k: string]: unknown };
  websocket: { url_new_thread: string; url_continue_thread: string; [k: string]: unknown };
  webhook: { urls: Array<{ name: string; url: string }>; note?: string };
  widget: { deployments: Array<{ deployment_id: string; embed_snippet: string }>; note?: string };
  mcp: { url: string; auth: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** Result of an AI-assisted build (`buildAgent`). */
export interface BuildResult {
  built: boolean;
  agent: Agent | null;
  agents: Agent[];
  notes: string;
  status: string;
  run_id: string;
  thread_id: string;
  [k: string]: unknown;
}

export class NebelusError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "NebelusError";
  }
}

export class NebelusConstruction {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: NebelusClientOptions) {
    this.apiKey = opts.apiKey;
    this.base = (opts.baseUrl ?? "https://api.nebelus.ai").replace(/\/$/, "");
    this._fetch = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this._fetch(`${this.base}/api/v1/construction${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || JSON.stringify(data))) || res.statusText;
      throw new NebelusError(`Construction API ${res.status}: ${msg}`, res.status, data);
    }
    return data as T;
  }

  /** The machine-readable "what can be built here" reference: capability registry,
   *  writable/rejected fields, this org's Build Envelope. Call first to discover the surface. */
  describe() { return this.call<Record<string, unknown>>("GET", "/describe/"); }

  /** The org's entitlement- and envelope-filtered options. */
  catalog(view = "models") { return this.call<unknown>("GET", `/catalog/?view=${encodeURIComponent(view)}`); }

  listAgents() { return this.call<Agent[]>("GET", "/agents/"); }
  getAgent(id: string) { return this.call<Agent>("GET", `/agents/${id}/`); }
  /** Create a DRAFT agent. */
  createAgent(fields: Partial<Agent> & { name: string }) { return this.call<Agent>("POST", "/agents/", fields); }
  /** AI-assisted build: describe an agent in plain language and the Nebelus Vibe Builder
   *  builds it as a DRAFT (returned with the builder's assumptions). Billed as AI credits
   *  at the build rate. The one SYNTHESISING call — createAgent et al. are deterministic. */
  buildAgent(prompt: string, constraints?: string) {
    return this.call<BuildResult>("POST", "/agents/build/", constraints ? { prompt, constraints } : { prompt });
  }
  updateAgent(id: string, fields: Partial<Agent>) { return this.call<Agent>("PATCH", `/agents/${id}/`, fields); }

  validate(id: string) { return this.call<unknown>("POST", `/agents/${id}/validate/`); }
  /** Run a test message against a draft (billed). */
  probe(id: string, message: string) { return this.call<unknown>("POST", `/agents/${id}/probe/`, { message }); }

  /** REST/WebSocket/webhook/embed/MCP wiring for an agent, region-correct. */
  wiring(id: string) { return this.call<Wiring>("GET", `/agents/${id}/wiring/`); }

  /** Publish a draft to active. Requires api.construction.deploy + the org's opt-in. */
  deploy(id: string) { return this.call<unknown>("POST", `/agents/${id}/deploy/`); }
}

export default NebelusConstruction;
