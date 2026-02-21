/**
 * Integration test for the hosted Hono MCP server.
 * Uses the MCP client SDK to connect via Streamable HTTP and call all 6 tools.
 * Uses a temp directory to avoid polluting the real vault.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const PORT = 3457;
const SERVER_ENTRY = resolve(
  import.meta.dirname,
  "../../packages/hosted/src/index.js",
);

describe("hosted MCP server", () => {
  let serverProcess;
  let client;
  let tmpDir;

  beforeAll(async () => {
    // Use isolated temp directory for vault data
    tmpDir = mkdtempSync(join(tmpdir(), "hosted-test-"));

    // Start the hosted server with temp vault
    serverProcess = spawn("node", [SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(PORT),
        CONTEXT_MCP_DATA_DIR: tmpDir,
        CONTEXT_MCP_VAULT_DIR: join(tmpDir, "vault"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for server to be ready (listening message goes to stdout)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Server start timeout")),
        15000,
      );
      const check = (data) => {
        if (data.toString().includes("listening")) {
          clearTimeout(timeout);
          resolve();
        }
      };
      serverProcess.stdout.on("data", check);
      serverProcess.stderr.on("data", check);
      serverProcess.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Connect MCP client
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${PORT}/mcp`),
    );
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {}
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((res) => serverProcess.on("exit", res));
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists all 7 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "context_status",
      "delete_context",
      "get_context",
      "ingest_url",
      "list_context",
      "save_context",
      "submit_feedback",
    ]);
  });

  it("calls context_status", async () => {
    const result = await client.callTool({
      name: "context_status",
      arguments: {},
    });
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toContain("Vault Status");
  });

  it("saves and retrieves an entry", async () => {
    // Save
    const saveResult = await client.callTool({
      name: "save_context",
      arguments: {
        kind: "insight",
        body: "Hosted mode works over HTTP transport",
        tags: ["test", "hosted"],
      },
    });
    expect(saveResult.content[0].text).toContain("Saved insight");

    // Extract ID from response
    const idMatch = saveResult.content[0].text.match(/id: (\S+)/);
    expect(idMatch).toBeTruthy();
    const entryId = idMatch[1];

    // Search
    const searchResult = await client.callTool({
      name: "get_context",
      arguments: { query: "hosted HTTP transport" },
    });
    expect(searchResult.content[0].text).toContain("hosted");

    // List
    const listResult = await client.callTool({
      name: "list_context",
      arguments: { kind: "insight" },
    });
    expect(listResult.content[0].text).toContain("Vault Entries");

    // Delete
    const deleteResult = await client.callTool({
      name: "delete_context",
      arguments: { id: entryId },
    });
    expect(deleteResult.content[0].text).toContain("Deleted");
  }, 30000);

  it("submits feedback", async () => {
    const result = await client.callTool({
      name: "submit_feedback",
      arguments: {
        type: "feature",
        title: "Test feedback",
        body: "This is a test feedback entry from the hosted integration test",
      },
    });
    expect(result.content[0].text).toContain("Feedback submitted");
  }, 30000);
});
