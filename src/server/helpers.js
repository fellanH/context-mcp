/**
 * helpers.js — Shared MCP response helpers and validation
 */

// ─── MCP Response Helpers ────────────────────────────────────────────────────

export function ok(text) {
  return { content: [{ type: "text", text }] };
}

export function err(text, code = "UNKNOWN") {
  return { content: [{ type: "text", text }], isError: true, code };
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

export function ensureVaultExists(config) {
  if (!config.vaultDirExists) {
    return err(`Vault directory not found: ${config.vaultDir}. Run context_status for diagnostics.`, "VAULT_NOT_FOUND");
  }
  return null;
}

export function ensureValidKind(kind) {
  if (!/^[a-z][a-z0-9_-]*$/.test(kind)) {
    return err("Required: kind (lowercase alphanumeric, e.g. 'insight', 'reference')", "INVALID_KIND");
  }
  return null;
}
