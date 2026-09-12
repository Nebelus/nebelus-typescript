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
  /** Default per-request timeout in ms for normal ops (default 120_000). AI-assisted
   *  ops (buildAgent, probe) use a longer budget — see AI_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Normal ops return fast. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** The Agent Builder / probe run a model server-side and can take minutes — 10 min
 *  (the edge allows up to 30). */
const AI_TIMEOUT_MS = 600_000;

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
  private readonly timeoutMs: number;

  constructor(opts: NebelusClientOptions) {
    this.apiKey = opts.apiKey;
    this.base = (opts.baseUrl ?? "https://api.nebelus.ai").replace(/\/$/, "");
    this._fetch = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    // Abort the request if the server hasn't responded in time — otherwise a long
    // AI build could hang past the runtime's own (e.g. undici 300s) default.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs ?? this.timeoutMs);
    let res: Response;
    try {
      res = await this._fetch(`${this.base}/api/v1/construction${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
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
    return this.call<BuildResult>("POST", "/agents/build/", constraints ? { prompt, constraints } : { prompt }, AI_TIMEOUT_MS);
  }
  updateAgent(id: string, fields: Partial<Agent>) { return this.call<Agent>("PATCH", `/agents/${id}/`, fields); }

  validate(id: string) { return this.call<unknown>("POST", `/agents/${id}/validate/`); }
  /** Run a test message against a draft (billed). Runs a model — longer budget. */
  probe(id: string, message: string) { return this.call<unknown>("POST", `/agents/${id}/probe/`, { message }, AI_TIMEOUT_MS); }

  /** REST/WebSocket/webhook/embed/MCP wiring for an agent, region-correct. */
  wiring(id: string) { return this.call<Wiring>("GET", `/agents/${id}/wiring/`); }

  /** Publish a draft to active. Requires api.construction.deploy + the org's opt-in. */
  deploy(id: string) { return this.call<unknown>("POST", `/agents/${id}/deploy/`); }

  // --- lifecycle ---
  archiveAgent(id: string) { return this.call<{ id: string; status: string }>("POST", `/agents/${id}/archive/`); }
  unarchiveAgent(id: string) { return this.call<{ id: string; status: string }>("DELETE", `/agents/${id}/archive/`); }

  // --- guardrails / governance on an agent ---
  setPolicies(id: string, policyIds: string[], mode = "replace") { return this.call<unknown>("POST", `/agents/${id}/policies/`, { policy_ids: policyIds, mode }); }
  setGroundingTrace(id: string, opts: Record<string, unknown> = {}) { return this.call<unknown>("POST", `/agents/${id}/grounding-trace/`, opts); }
  setTriggers(id: string, usedTriggers: unknown[]) { return this.call<unknown>("PUT", `/agents/${id}/triggers/`, { used_triggers: usedTriggers }); }

  // --- workflow graph ---
  getGraph(id: string) { return this.call<unknown>("GET", `/agents/${id}/graph/`); }
  graphOp(id: string, op: string, args: Record<string, unknown> = {}) { return this.call<unknown>("POST", `/agents/${id}/graph/`, { op, ...args }); }

  // --- schedules ---
  listSchedules(id: string) { return this.call<unknown>("GET", `/agents/${id}/schedules/`); }
  createSchedule(id: string, name: string, instruction: string, cadence: Record<string, unknown> = {}) { return this.call<unknown>("POST", `/agents/${id}/schedules/`, { name, instruction, ...cadence }); }
  cancelSchedule(id: string, scheduleId: string) { return this.call<unknown>("DELETE", `/agents/${id}/schedules/${scheduleId}/`); }

  // --- sub-agents (the sub-agent's id travels in the body) ---
  attachSubAgent(id: string, subAgentId: string, opts: { instruction?: string; mode?: string; stream_to_client?: boolean } = {}) { return this.call<unknown>("POST", `/agents/${id}/sub-agents/`, { agent_id: subAgentId, mode: "as_tool", ...opts }); }
  detachSubAgent(id: string, subAgentId: string) { return this.call<unknown>("DELETE", `/agents/${id}/sub-agents/`, { agent_id: subAgentId }); }

  // --- tools & connectors (id in the path) ---
  attachAiTool(id: string, toolId: string) { return this.call<unknown>("POST", `/agents/${id}/ai-tools/${toolId}/`); }
  detachAiTool(id: string, toolId: string) { return this.call<unknown>("DELETE", `/agents/${id}/ai-tools/${toolId}/`); }
  attachCodeConnector(id: string, connectorId: string) { return this.call<unknown>("POST", `/agents/${id}/code-connectors/${connectorId}/`); }
  detachCodeConnector(id: string, connectorId: string) { return this.call<unknown>("DELETE", `/agents/${id}/code-connectors/${connectorId}/`); }
  attachMcpServer(id: string, serverId: string) { return this.call<unknown>("POST", `/agents/${id}/mcp-servers/${serverId}/`); }
  detachMcpServer(id: string, serverId: string) { return this.call<unknown>("DELETE", `/agents/${id}/mcp-servers/${serverId}/`); }
  /** Attach a custom API endpoint. Optional auth-by-REFERENCE only (no raw secrets). */
  attachApiEndpoint(id: string, endpointId: string, auth: Record<string, unknown> = {}) { return this.call<unknown>("POST", `/agents/${id}/api-endpoints/${endpointId}/`, Object.keys(auth).length ? auth : undefined); }
  detachApiEndpoint(id: string, endpointId: string) { return this.call<unknown>("DELETE", `/agents/${id}/api-endpoints/${endpointId}/`); }
  attachVectorStore(id: string, storeId: string) { return this.call<unknown>("POST", `/agents/${id}/vector-stores/${storeId}/`); }
  detachVectorStore(id: string, storeId: string) { return this.call<unknown>("DELETE", `/agents/${id}/vector-stores/${storeId}/`); }

  // --- knowledge bases ---
  vectorStores(query?: string) { return this.call<{ results: unknown[] }>("GET", `/vector-stores/${query ? `?query=${encodeURIComponent(query)}` : ""}`); }
  createVectorStore(name: string, metadata?: Record<string, unknown>) { return this.call<unknown>("POST", "/vector-stores/", { name, metadata }); }
  updateVectorStore(storeId: string, fields: { name?: string; metadata?: Record<string, unknown> }) { return this.call<unknown>("PATCH", `/vector-stores/${storeId}/`, fields); }
  deleteVectorStore(storeId: string, force = false) { return this.call<unknown>("DELETE", `/vector-stores/${storeId}/${force ? "?force=true" : ""}`); }
  ingestFile(storeId: string, fileId: string) { return this.call<unknown>("POST", `/vector-stores/${storeId}/ingest/`, { file_id: fileId }); }

  // --- custom API endpoints (outbound tool endpoints) ---
  apiEndpoints(query?: string) { return this.call<{ results: unknown[] }>("GET", `/api-endpoints/${query ? `?query=${encodeURIComponent(query)}` : ""}`); }
  createApiEndpoint(fields: Record<string, unknown>) { return this.call<unknown>("POST", "/api-endpoints/", fields); }
  updateApiEndpoint(endpointId: string, fields: Record<string, unknown>) { return this.call<unknown>("PATCH", `/api-endpoints/${endpointId}/`, fields); }
  testApiEndpoint(endpointId: string, testParameters?: Record<string, unknown>) { return this.call<unknown>("POST", `/api-endpoints/${endpointId}/test/`, { test_parameters: testParameters }); }

  // --- MCP servers ---
  mcpServers(query?: string) { return this.call<{ results: unknown[] }>("GET", `/mcp-servers/${query ? `?query=${encodeURIComponent(query)}` : ""}`); }
  createMcpServer(fields: Record<string, unknown>) { return this.call<unknown>("POST", "/mcp-servers/", fields); }
  updateMcpServer(serverId: string, fields: Record<string, unknown>) { return this.call<unknown>("PATCH", `/mcp-servers/${serverId}/`, fields); }
  probeMcpServer(fields: Record<string, unknown> = {}) { return this.call<unknown>("POST", "/mcp-servers/probe/", fields); }

  // --- deployments ---
  deployments() { return this.call<unknown>("GET", "/deployments/"); }
  createDeployment(agentId: string, deploymentType: string, name: string, extra: Record<string, unknown> = {}) { return this.call<unknown>("POST", "/deployments/", { agent_id: agentId, deployment_type: deploymentType, name, ...extra }); }
  updateDeployment(deploymentId: string, fields: { name?: string; description?: string; config_patch?: Record<string, unknown> }) { return this.call<unknown>("PATCH", `/deployments/${deploymentId}/`, fields); }
  activateDeployment(deploymentId: string, active = true) { return this.call<unknown>("POST", `/deployments/${deploymentId}/activate/`, { active }); }
  probeDeployment(deploymentId: string) { return this.call<unknown>("GET", `/deployments/${deploymentId}/probe/`); }

  // --- governance policies ---
  policies() { return this.call<{ results: unknown[] }>("GET", "/policies/"); }
  createPolicy(fields: Record<string, unknown>) { return this.call<unknown>("POST", "/policies/", fields); }
  activatePolicy(policyId: string, active = true) { return this.call<unknown>("POST", `/policies/${policyId}/activate/`, { active }); }

  // --- API keys (mint from code; the deploy scope needs the org's opt-in) ---
  apiKeys() { return this.call<{ results: unknown[] }>("GET", "/api-keys/"); }
  /** Mint an API key — the full value is in the response ONCE (`sensitive_id`). */
  createApiKey(scopes: string[], name?: string, isServiceAccount = false) {
    return this.call<Record<string, unknown>>("POST", "/api-keys/", { scopes, name, is_service_account: isServiceAccount });
  }
}

export default NebelusConstruction;
