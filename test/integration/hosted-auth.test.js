/**
 * Integration tests for hosted server auth and management API.
 * Uses a unique temp directory per test run to avoid state leakage.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3458;
const BASE = `http://localhost:${PORT}`;
const SERVER_ENTRY = resolve(import.meta.dirname, "../../packages/hosted/src/index.js");

// Use unique email prefix per run to avoid collisions
const RUN_ID = Date.now().toString(36);

describe("hosted auth + management API", () => {
  let serverProcess;
  let tmpDir;

  beforeAll(async () => {
    // Isolated data dir for this test run
    tmpDir = mkdtempSync(join(tmpdir(), "hosted-auth-test-"));

    serverProcess = spawn("node", [SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(PORT),
        AUTH_REQUIRED: "true",
        CONTEXT_MCP_DATA_DIR: tmpDir,
        CONTEXT_MCP_VAULT_DIR: join(tmpDir, "vault"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server start timeout")), 15000);
      const check = (data) => {
        if (data.toString().includes("listening")) {
          clearTimeout(timeout);
          resolve();
        }
      };
      serverProcess.stdout.on("data", check);
      serverProcess.stderr.on("data", check);
      serverProcess.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
  }, 30000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((res) => serverProcess.on("exit", res));
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("health check works without auth", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.auth).toBe(true);
  });

  it("MCP endpoint rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("registers a user and gets an API key", async () => {
    const res = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `reg-${RUN_ID}@test.com`, name: "Test User" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.userId).toBeTruthy();
    expect(data.apiKey.key).toMatch(/^cv_/);
    expect(data.tier).toBe("free");
  });

  it("rejects duplicate registration", async () => {
    const res = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `reg-${RUN_ID}@test.com` }),
    });
    expect(res.status).toBe(409);
  });

  it("full flow: register → auth → MCP tool call", async () => {
    // Register
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `flow-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();

    // Connect MCP client with auth
    const transport = new StreamableHTTPClientTransport(
      new URL(`${BASE}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${apiKey.key}` } } }
    );
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);

    // List tools
    const { tools } = await client.listTools();
    expect(tools.length).toBe(6);

    // Call context_status
    const result = await client.callTool({ name: "context_status", arguments: {} });
    expect(result.content[0].text).toContain("Vault Status");

    await client.close();
  }, 30000);

  it("key management: list and create keys", async () => {
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `keys-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();
    const authHeaders = { Authorization: `Bearer ${apiKey.key}`, "Content-Type": "application/json" };

    // List keys (should have 1)
    const listRes = await fetch(`${BASE}/api/keys`, { headers: authHeaders });
    expect(listRes.status).toBe(200);
    const { keys } = await listRes.json();
    expect(keys.length).toBe(1);

    // Create another key
    const createRes = await fetch(`${BASE}/api/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "second-key" }),
    });
    expect(createRes.status).toBe(201);
    const newKey = await createRes.json();
    expect(newKey.key).toMatch(/^cv_/);
    expect(newKey.name).toBe("second-key");

    // List again (should have 2)
    const listRes2 = await fetch(`${BASE}/api/keys`, { headers: authHeaders });
    const { keys: keys2 } = await listRes2.json();
    expect(keys2.length).toBe(2);

    // Delete the new key
    const delRes = await fetch(`${BASE}/api/keys/${newKey.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    expect(delRes.status).toBe(200);

    // List again (should have 1)
    const listRes3 = await fetch(`${BASE}/api/keys`, { headers: authHeaders });
    const { keys: keys3 } = await listRes3.json();
    expect(keys3.length).toBe(1);
  });

  // ─── Vault Import/Export ───────────────────────────────────────────────────

  it("import: valid entry returns id", async () => {
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `import-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();
    const authHeaders = { Authorization: `Bearer ${apiKey.key}`, "Content-Type": "application/json" };

    const res = await fetch(`${BASE}/api/vault/import`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "insight", body: "Test import entry", tags: ["test"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.id).toHaveLength(26); // ULID length
  });

  it("import: missing body returns 400", async () => {
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `import-nobody-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();
    const authHeaders = { Authorization: `Bearer ${apiKey.key}`, "Content-Type": "application/json" };

    const res = await fetch(`${BASE}/api/vault/import`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ kind: "insight" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("body");
  });

  it("import: missing kind returns 400", async () => {
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `import-nokind-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();
    const authHeaders = { Authorization: `Bearer ${apiKey.key}`, "Content-Type": "application/json" };

    const res = await fetch(`${BASE}/api/vault/import`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ body: "No kind provided" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("kind");
  });

  it("export: free tier returns 403", async () => {
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `export-free-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();

    const res = await fetch(`${BASE}/api/vault/export`, {
      headers: { Authorization: `Bearer ${apiKey.key}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("free tier");
  });

  it("usage tracking endpoint returns data", async () => {
    const regRes = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `usage-${RUN_ID}@test.com` }),
    });
    const { apiKey } = await regRes.json();

    const res = await fetch(`${BASE}/api/billing/usage`, {
      headers: { Authorization: `Bearer ${apiKey.key}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("free");
    expect(data.usage.requestsToday).toBeDefined();
  });
});
