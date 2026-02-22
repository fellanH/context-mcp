import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TELEMETRY_ENDPOINT = "https://api.context-vault.com/telemetry";
const NOTICE_MARKER = ".telemetry-notice-shown";

export function isTelemetryEnabled(config) {
  const envVal = process.env.CONTEXT_VAULT_TELEMETRY;
  if (envVal !== undefined) return envVal === "1" || envVal === "true";
  return config?.telemetry === true;
}

/**
 * Fire-and-forget telemetry event. Never throws, never blocks.
 * Payload contains only: event, code, tool, cv_version, node_version, platform, arch, ts.
 * No message text, stack traces, vault content, file paths, or user identifiers.
 */
export function sendTelemetryEvent(config, payload) {
  if (!isTelemetryEnabled(config)) return;

  const event = {
    event: payload.event,
    code: payload.code || null,
    tool: payload.tool || null,
    cv_version: payload.cv_version,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    ts: new Date().toISOString(),
  };

  fetch(TELEMETRY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/**
 * Print the one-time telemetry notice to stderr.
 * Uses a marker file in dataDir to ensure it's only shown once.
 */
export function maybeShowTelemetryNotice(dataDir) {
  try {
    const markerPath = join(dataDir, NOTICE_MARKER);
    if (existsSync(markerPath)) return;
    writeFileSync(markerPath, new Date().toISOString() + "\n");
  } catch {
    return;
  }

  const lines = [
    "[context-vault] Telemetry: disabled by default.",
    "[context-vault] To help improve context-vault, you can opt in to anonymous error reporting.",
    "[context-vault] Reports contain only: event type, error code, tool name, version, node version, platform, arch, timestamp.",
    "[context-vault] No vault content, file paths, or personal data is ever sent.",
    '[context-vault] Opt in: set "telemetry": true in ~/.context-mcp/config.json or set CONTEXT_VAULT_TELEMETRY=1.',
    "[context-vault] Full payload schema: https://contextvault.dev/telemetry",
  ];
  for (const line of lines) {
    process.stderr.write(line + "\n");
  }
}
