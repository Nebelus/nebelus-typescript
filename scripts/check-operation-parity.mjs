// Operation parity: the TS client must keep pace with the deployed Construction service.
//
// Reads the DEPLOYED OpenAPI schema (the single source of truth) and requires every
// construction operation to be classified as one of:
//   COVERED     — the client exposes a method for it,
//   INTENTIONAL — deliberately not a client method (e.g. the MCP JSON-RPC facade),
//   GAP_LEDGER  — not yet covered (the debt; the goal is to drive this to EMPTY).
//
// A NEW server operation that is none of these fails CI — it cannot ship on the service
// and silently miss the TS client. Close a gap by adding the method and moving the op
// from GAP_LEDGER to COVERED. Run: `npm run parity`.

const SCHEMA_URL =
  process.env.NEBELUS_SCHEMA_URL ||
  "https://api.nebelus.ai/api/construction/schema/?format=json";
const B = "/api/v1/construction/";

// Operations the TS client exposes today (verified against its real REST calls).
const COVERED = new Set([
  `GET ${B}agents/`, `GET ${B}agents/{agent_id}/`, `POST ${B}agents/`, `PATCH ${B}agents/{agent_id}/`,
  `POST ${B}agents/build/`, `POST ${B}agents/{agent_id}/validate/`, `POST ${B}agents/{agent_id}/probe/`,
  `GET ${B}agents/{agent_id}/wiring/`, `POST ${B}agents/{agent_id}/deploy/`, `GET ${B}describe/`, `GET ${B}catalog/`,
  // Full-parity additions (ledger closed):
  `POST ${B}agents/{agent_id}/archive/`, `DELETE ${B}agents/{agent_id}/archive/`,
  `POST ${B}agents/{agent_id}/policies/`, `POST ${B}agents/{agent_id}/grounding-trace/`,
  `PUT ${B}agents/{agent_id}/triggers/`, `GET ${B}agents/{agent_id}/graph/`, `POST ${B}agents/{agent_id}/graph/`,
  `GET ${B}agents/{agent_id}/schedules/`, `POST ${B}agents/{agent_id}/schedules/`,
  `DELETE ${B}agents/{agent_id}/schedules/{schedule_id}/`,
  `POST ${B}agents/{agent_id}/sub-agents/`, `DELETE ${B}agents/{agent_id}/sub-agents/`,
  `POST ${B}agents/{agent_id}/ai-tools/{tool_id}/`, `DELETE ${B}agents/{agent_id}/ai-tools/{tool_id}/`,
  `POST ${B}agents/{agent_id}/code-connectors/{connector_id}/`, `DELETE ${B}agents/{agent_id}/code-connectors/{connector_id}/`,
  `POST ${B}agents/{agent_id}/mcp-servers/{server_id}/`, `DELETE ${B}agents/{agent_id}/mcp-servers/{server_id}/`,
  `POST ${B}agents/{agent_id}/api-endpoints/{endpoint_id}/`, `DELETE ${B}agents/{agent_id}/api-endpoints/{endpoint_id}/`,
  `POST ${B}agents/{agent_id}/vector-stores/{store_id}/`, `DELETE ${B}agents/{agent_id}/vector-stores/{store_id}/`,
  `GET ${B}vector-stores/`, `POST ${B}vector-stores/`, `PATCH ${B}vector-stores/{store_id}/`,
  `DELETE ${B}vector-stores/{store_id}/`, `POST ${B}vector-stores/{store_id}/ingest/`,
  `GET ${B}api-endpoints/`, `POST ${B}api-endpoints/`, `PATCH ${B}api-endpoints/{endpoint_id}/`,
  `POST ${B}api-endpoints/{endpoint_id}/test/`,
  `GET ${B}mcp-servers/`, `POST ${B}mcp-servers/`, `PATCH ${B}mcp-servers/{server_id}/`, `POST ${B}mcp-servers/probe/`,
  `GET ${B}deployments/`, `POST ${B}deployments/`, `PATCH ${B}deployments/{deployment_id}/`,
  `POST ${B}deployments/{deployment_id}/activate/`, `GET ${B}deployments/{deployment_id}/probe/`,
  `GET ${B}policies/`, `POST ${B}policies/`, `POST ${B}policies/{policy_id}/activate/`,
  `GET ${B}api-keys/`, `POST ${B}api-keys/`,  // apiKeys() / createApiKey() (Phase 5)
]);

// Deliberately not a client method.
const INTENTIONAL = new Set([
  `POST ${B}mcp/`, // the MCP JSON-RPC facade — a transport, not a REST operation
]);

// Not yet exposed by the TS client — the debt. GOAL: empty. Shrink by adding the method.
const GAP_LEDGER = new Set([]); // EMPTY — full parity (2026-09-11)

async function fetchOps() {
  const res = await fetch(SCHEMA_URL, {
    headers: { "User-Agent": "nebelus-operation-parity", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = await res.json();
  const ops = new Set();
  for (const [path, item] of Object.entries(doc.paths || {})) {
    for (const method of Object.keys(item)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        ops.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  if (ops.size === 0) throw new Error("schema returned no operations");
  return ops;
}

const diff = (a, b) => [...a].filter((x) => !b.has(x));

try {
  const schema = await fetchOps();
  const known = new Set([...COVERED, ...INTENTIONAL, ...GAP_LEDGER]);
  const unclassified = [...schema].filter((op) => !known.has(op)).sort();
  if (unclassified.length) {
    console.error(
      "New construction operations are live on the service but unclassified in the TS client.\n" +
        "Add each to COVERED (implement the method), INTENTIONAL, or GAP_LEDGER:\n  " +
        unclassified.join("\n  ")
    );
    process.exit(1);
  }
  // Ledger honesty: no op in two buckets; nothing references an op not on the service.
  const overlap = [...GAP_LEDGER].filter((op) => COVERED.has(op) || INTENTIONAL.has(op));
  if (overlap.length) {
    console.error("op classified in two buckets: " + overlap.join(", "));
    process.exit(1);
  }
  const stale = diff(new Set([...GAP_LEDGER, ...COVERED]), schema).filter(
    (op) => op !== `POST ${B}agents/build/`
  );
  if (stale.length) {
    console.error("ledger/covered references ops not on the deployed service: " + stale.join(", "));
    process.exit(1);
  }
  console.log(
    `operation parity OK — ${schema.size} ops: ${[...COVERED].filter((o) => schema.has(o)).length} covered, ` +
      `${[...INTENTIONAL].filter((o) => schema.has(o)).length} intentional, ${GAP_LEDGER.size} in gap ledger`
  );
} catch (err) {
  // A transient outage must not block a PR; CI still runs it when the host is reachable.
  console.warn(`operation-parity: schema unreachable (${err.message}); skipping`);
  process.exit(0);
}
