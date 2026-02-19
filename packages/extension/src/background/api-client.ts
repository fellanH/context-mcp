/**
 * api-client.ts — REST API client for the background service worker.
 *
 * All API calls go through the service worker to avoid CORS issues.
 * Mirrors the pattern from packages/app/src/app/lib/api.ts.
 */

import type { Entry, SearchResult, ExtensionSettings } from "@/shared/types";

// Intentionally volatile — resets when the service worker is terminated.
// On restart, getSettings() falls back to chrome.storage.local automatically.
let cachedSettings: ExtensionSettings | null = null;

async function getSettings(): Promise<ExtensionSettings> {
  if (cachedSettings) return cachedSettings;
  const result = await chrome.storage.local.get(["serverUrl", "apiKey", "mode"]);
  cachedSettings = {
    serverUrl: result.serverUrl || "",
    apiKey: result.apiKey || "",
    mode: result.mode || "hosted",
  };
  return cachedSettings;
}

/** Clear settings cache (call after settings change) */
export function clearSettingsCache(): void {
  cachedSettings = null;
}

const RETRY_BACKOFF_MS = [1000, 3000];
const FETCH_TIMEOUT_MS = 15_000;
const NO_RETRY_STATUSES = new Set([401, 429]);

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { serverUrl, apiKey, mode } = await getSettings();

  if (!serverUrl) throw new Error("Not configured — set server URL in extension settings");
  if (mode === "hosted" && !apiKey) throw new Error("Not configured — set API key in extension settings");

  const url = `${serverUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Only include auth header when apiKey is set
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        const err = new Error(body.error || `API error: ${res.status}`);
        (err as any).status = res.status;

        // Don't retry auth errors or rate limits
        if (NO_RETRY_STATUSES.has(res.status)) throw err;

        lastError = err;
        if (attempt < RETRY_BACKOFF_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
        throw err;
      }

      // Store rate limit headers for UI consumption
      const remaining = res.headers.get("X-RateLimit-Remaining");
      const reset = res.headers.get("X-RateLimit-Reset");
      if (remaining !== null || reset !== null) {
        const rateLimitData: Record<string, string> = {};
        if (remaining !== null) rateLimitData.rateLimitRemaining = remaining;
        if (reset !== null) rateLimitData.rateLimitReset = reset;
        chrome.storage.local.set(rateLimitData);
      }

      return res.json();
    } catch (err) {
      // AbortError means timeout — eligible for retry
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);
        if (attempt < RETRY_BACKOFF_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
      }

      // Non-retryable errors (including 401/429 rethrown above)
      if ((err as any).status && NO_RETRY_STATUSES.has((err as any).status)) throw err;

      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
        continue;
      }
    }
  }

  throw lastError || new Error("apiFetch failed after retries");
}

/** Search the vault with hybrid semantic + full-text search */
export async function searchVault(
  query: string,
  opts: { kind?: string; category?: string; limit?: number } = {}
): Promise<{ results: SearchResult[]; count: number; query: string }> {
  return apiFetch("/api/vault/search", {
    method: "POST",
    body: JSON.stringify({ query, ...opts }),
  });
}

/** Create a new vault entry */
export async function createEntry(data: {
  kind: string;
  body: string;
  title?: string;
  tags?: string[];
  source?: string;
  identity_key?: string;
}): Promise<Entry> {
  return apiFetch("/api/vault/entries", {
    method: "POST",
    body: JSON.stringify({ ...data, source: data.source || "browser-extension" }),
  });
}

/** Get vault status (doubles as connection test) */
export async function getVaultStatus(): Promise<{ health: string; entries: { total: number } }> {
  return apiFetch("/api/vault/status");
}
