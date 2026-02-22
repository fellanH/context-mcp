/**
 * helpers.js — Shared MCP response helpers and validation
 */

import pkg from "../../package.json" with { type: "json" };

export function ok(text) {
  return { content: [{ type: "text", text }] };
}

export function err(text, code = "UNKNOWN", meta = {}) {
  return {
    content: [{ type: "text", text }],
    isError: true,
    code,
    _meta: {
      cv_version: pkg.version,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      ...meta,
    },
  };
}

export function ensureVaultExists(config) {
  if (!config.vaultDirExists) {
    return err(
      `Vault directory not found: ${config.vaultDir}. Run context-status for diagnostics.`,
      "VAULT_NOT_FOUND",
    );
  }
  return null;
}

export function ensureValidKind(kind) {
  if (!/^[a-z][a-z0-9_-]*$/.test(kind)) {
    return err(
      "Required: kind (lowercase alphanumeric, e.g. 'insight', 'reference')",
      "INVALID_KIND",
    );
  }
  return null;
}
