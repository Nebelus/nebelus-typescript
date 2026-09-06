# @nebelus/construction

TypeScript client for the **Nebelus Construction API** — build, edit, test and (with opt-in) publish AI agents in code, on the same universal service layer behind the visual builders and the MCP facade.

> Peer to the Python SDK (`pip install nebelus`). Agents are always born as **drafts**; publishing needs the `api.construction.deploy` scope **and** your org's programmatic-deploy opt-in.

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

// Build a draft
const agent = await nb.createAgent({ name: "Support bot", model_id: "openai/gpt-4o-mini" });
await nb.updateAgent(agent.id, { system_message: "You are a concise support agent." });

// Test it, then read how to wire it into your app
await nb.probe(agent.id, "Hello!");
const wiring = await nb.wiring(agent.id);   // REST/WebSocket/webhook/embed/MCP URLs

// Publish (needs deploy scope + org opt-in)
await nb.deploy(agent.id);
```

## Fully-typed request/response bodies

This hand-written client covers the core workflow dependency-free. For exhaustive types over **every** endpoint, generate them from the live OpenAPI document:

```bash
npm run gen:types   # openapi-typescript https://api.nebelus.ai/api/construction/schema/ -o src/schema.d.ts
```

The same schema powers the Swagger UI at `https://api.nebelus.ai/api/construction/docs/`.

## Surfaces

Everything here is also available via:
- **Visual builders** (chat + manual) in the Nebelus console
- **MCP** — `https://api.nebelus.ai/api/v1/construction/mcp/` (connect Claude/Cursor)
- **Python SDK/CLI** — `pip install nebelus`

The **same agent** is editable across all of them — one artifact, not copies.
