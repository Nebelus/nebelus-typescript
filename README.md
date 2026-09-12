# @nebelus/construction

TypeScript client for the **Nebelus Construction API** — build, edit, test and (with opt-in) publish AI agents in code, on the same universal service layer behind the visual builders and the MCP facade.

> Peer to the Python SDK (`pip install nebelus`). Agents are always born as **drafts**; publishing needs the `api.construction.deploy` scope **and** your org's programmatic-deploy opt-in.

## Two surfaces, two scopes

Nebelus has a clean split, and this package covers only the first:

- **Build** (this package) — create/edit/test/deploy agents. Uses an **`api.construction.*`** key. Same universal service behind the visual builders and the MCP facade.
- **Invoke** — call a *deployed* agent to have a conversation. A plain HTTP/WebSocket surface (no SDK needed), authenticated with an **`api.agents.*`** key. See [Invoke a deployed agent](#invoke-a-deployed-agent) below.

Mint each scope separately (Settings → API keys, or `createApiKey`). Deploying an agent makes it **active**; once active, an `api.agents.*` key can call it over REST and WebSocket immediately — no per-channel step required.

> ⚠️ Never ship an `api.construction.*` key to a browser. A public web-widget embed must use an **`api.agents`-only** key.

## Install

```bash
npm install @nebelus/construction
```

## Usage

```ts
import { NebelusConstruction } from "@nebelus/construction";

const nb = new NebelusConstruction({
  apiKey: process.env.NEBELUS_API_KEY!,      // Settings → API keys (api.construction.*)
  baseUrl: "https://api.nebelus.ai",          // KSA: https://api.ksa.nebelus.ai
});

// Discover what this org can build (capability registry + Build Envelope)
const surface = await nb.describe();

// AI-assisted build: describe it and the Vibe Builder builds the draft for you
const built = await nb.buildAgent("a support agent that answers from our return policy and escalates ambiguous cases");
// built.agent is the draft; built.notes carries the builder's assumptions

// ...or build a draft deterministically, field by field
const agent = await nb.createAgent({ name: "Support bot", model_id: "openai/gpt-4o-mini" });
await nb.updateAgent(agent.id, { system_message: "You are a concise support agent." });

// Test the DRAFT without deploying, then read how to wire it into your app
await nb.probe(agent.id, "Hello");
const wiring = await nb.wiring(agent.id);   // REST/WebSocket/webhook/embed/MCP URLs

// Deploy = make the agent active. Needs the deploy scope + org opt-in.
// Once active, invoke it with an api.agents.* key (see below).
await nb.deploy(agent.id);
```

## Invoke a deployed agent

Once an agent is **active**, call it over plain HTTP with an **`api.agents.*`** key — no SDK required. The public REST invoke endpoint is OpenAI-style:

```bash
curl https://api.nebelus.ai/api/agents/<AGENT_ID>/chat/ \
  -H "Authorization: Bearer $NEBELUS_AGENTS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

- **Endpoint:** `POST https://api.nebelus.ai/api/agents/<AGENT_ID>/chat/` (KSA orgs: `https://api.ksa.nebelus.ai/...` — the region follows the org).
- **Body:** OpenAI-style `{"messages":[...]}`, plus optional `"thread_id"` and `"stream"`. The response is a `chat.completion` shape carrying a top-level `thread_id`, `message`, and `usage`.
- **Threads:** omit `thread_id` to start a new conversation; pass the returned `thread_id` back to continue — the server keeps history, so you need not resend prior turns (`session_id` is an alias).

> ℹ️ Use `/api/agents/<id>/chat/`, **not** `/api/v1/agents/<id>/chat/` (a deployment-gated internal twin), and send `{"messages":[...]}`, **not** a single `{"message":"..."}` body.

### Streaming (SSE)

Add `"stream":true` (or send `Accept: text/event-stream`). Event frames: `message_start` (carries `thread_id`), `content_block` (start/delta/complete), `message_delta`, `usage_metadata` (incl. prompt-cache read/creation), `cost_update` (in-stream cost in EUR/USD/SAR + markup), `thread_title`, `message_stop`.

### WebSocket

```
wss://api.nebelus.ai/ws/agents/<AGENT_ID>/chat/?api_key=<AGENTS_KEY>
```

Authenticate with `?api_key=<key>` (browsers can't set WS headers) or an `Authorization: Bearer <key>` header. Send `{"type":"chat","content":"..."}`; the server emits the same event frames as SSE. A pure API-key client works — this is not session/JWT only.

### Region

EU orgs invoke via `api.nebelus.ai`; KSA/GCC orgs via `api.ksa.nebelus.ai`. An org is bound to one region — `wiring()` returns the region-correct URLs.

## Web widget & webhooks

- **Web widget** — a browser-embeddable channel. Create it with `createDeployment(agentId, "web-widget", name)`, activate it with `activateDeployment(deploymentId, true)`, then read the embed snippet from `wiring()`. Embed an **`api.agents`-only** key. Logo / allowed-domains / analytics live in the portal.
- **Webhook trigger** — set with `setTriggers(id, [{ webhook_received: { webhook_url: "" } }])`. The `/w/<key>/` URL requires an auth token by default: header `X-Webhook-Token: <secret>` (or `?X-Webhook-Token=<secret>` for query-param webhooks) — the URL alone returns 401. It is fire-and-forget: it acknowledges receipt and runs the agent in the background (not an inline reply).

> ⚠️ **Identity gate.** Self-serve / Developers orgs (`identity_verified=false`) get the web widget and in-portal testing immediately, but **external channels (webhooks/triggers and non-widget deployments) unlock only after identity verification.**

## Billing

Standard agent runs are metered per run on real provider tokens across **all** invoke surfaces — non-streaming REST, streaming SSE, WebSocket, web widget, and webhook/trigger runs. Build/edit/test (`buildAgent`, `probe`, edits) draw the separate **AI-credits** pool. In SSE, `cost_update` reports per-turn cost.

## Fully-typed request/response bodies

This hand-written client covers the core workflow dependency-free. For exhaustive types over **every** construction endpoint, generate them from the live OpenAPI document:

```bash
npm run gen:types   # openapi-typescript https://api.nebelus.ai/api/construction/schema/ -o src/schema.d.ts
```

The same schema powers the Swagger UI at `https://api.nebelus.ai/api/construction/docs/`.

## Surfaces

Everything in this **build** package is also available via:
- **Visual builders** (chat + manual) in the Nebelus console
- **MCP** — `https://api.nebelus.ai/api/v1/construction/mcp/` (JSON-RPC 2.0 over streamable HTTP; connect Claude/Cursor). Full build parity **minus deploy** — there is no deploy tool over MCP, by design. Auth with an `api.construction.*` key or OAuth 2.1.
- **Python SDK/CLI** — `pip install nebelus`

The **same agent** is editable across all of them — one artifact, not copies.
