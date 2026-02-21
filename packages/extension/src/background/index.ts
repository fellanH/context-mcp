/**
 * Background service worker — handles API communication,
 * context menus, and message routing between popup and content scripts.
 */

import {
  searchVault,
  createEntry,
  getVaultStatus,
  clearSettingsCache,
  probeServer,
} from "./api-client";
import type { MessageType, VaultMode } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";

const CONTEXT_MENU_PARENT_ID = "save-to-vault";
const CONTEXT_MENU_VARIANTS = [
  {
    id: "save-as-insight",
    title: "Save as Insight",
    kind: "insight",
    tags: ["captured", "insight"],
  },
  {
    id: "save-as-note",
    title: "Save as Note",
    kind: "note",
    tags: ["captured", "note"],
  },
  {
    id: "save-as-reference",
    title: "Save as Reference",
    kind: "reference",
    tags: ["captured", "reference"],
  },
  {
    id: "save-as-snippet",
    title: "Save as Code Snippet",
    kind: "snippet",
    tags: ["captured", "code"],
  },
] as const;

// ─── Badge ──────────────────────────────────────────────────────────────────

function updateBadge(connected: boolean): void {
  if (connected) {
    chrome.action.setBadgeText({ text: "" });
  } else {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  }
}

// ─── Permissions ─────────────────────────────────────────────────────────────

function originPatternFromServerUrl(serverUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl.trim());
  } catch {
    throw new Error(
      "Invalid server URL. Use a full URL like https://app.context-vault.com",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Server URL must use http:// or https://");
  }

  // Permission match patterns ignore URL path and do not require a port.
  return `${parsed.protocol}//${parsed.host}/*`;
}

function containsOriginPermission(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [origin] }, (granted) =>
      resolve(Boolean(granted)),
    );
  });
}

function requestOriginPermission(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [origin] }, (granted) =>
      resolve(Boolean(granted)),
    );
  });
}

async function ensureServerPermission(serverUrl: string): Promise<string> {
  const origin = originPatternFromServerUrl(serverUrl);
  const hasPermission = await containsOriginPermission(origin);
  if (hasPermission) return origin;

  const granted = await requestOriginPermission(origin);
  if (!granted) {
    throw new Error(
      `Permission denied for ${origin}. Allow host access to connect this server.`,
    );
  }

  return origin;
}

// ─── Connection Logic ────────────────────────────────────────────────────────

function isConnected(
  mode: VaultMode,
  serverUrl: string,
  apiKey: string,
  vaultPath?: string,
): boolean {
  if (mode === "local") return Boolean(vaultPath);
  return Boolean(serverUrl && apiKey);
}

// ─── Context Menu ───────────────────────────────────────────────────────────

function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PARENT_ID,
      title: "Save to Context Vault",
      contexts: ["selection"],
    });

    for (const item of CONTEXT_MENU_VARIANTS) {
      chrome.contextMenus.create({
        id: item.id,
        parentId: CONTEXT_MENU_PARENT_ID,
        title: item.title,
        contexts: ["selection"],
      });
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  setupContextMenus();

  chrome.storage.local.get(
    ["apiKey", "mode", "serverUrl", "vaultPath"],
    (stored) => {
      const mode: VaultMode = stored.mode || DEFAULT_SETTINGS.mode;
      updateBadge(
        isConnected(
          mode,
          stored.serverUrl || "",
          stored.apiKey || "",
          stored.vaultPath || "",
        ),
      );
    },
  );

  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/index.html") });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selected = info.selectionText?.trim();
  if (!selected) return;

  const variant = CONTEXT_MENU_VARIANTS.find(
    (item) => item.id === info.menuItemId,
  );
  if (!variant) return;

  try {
    const source = (() => {
      try {
        return tab?.url ? new URL(tab.url).hostname : "browser-extension";
      } catch {
        return "browser-extension";
      }
    })();

    const entry = await createEntry({
      kind: variant.kind,
      body: selected,
      title: selected.slice(0, 80) + (selected.length > 80 ? "..." : ""),
      source,
      tags: [...variant.tags],
    });

    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "capture_result",
        id: entry.id,
      } satisfies MessageType);
    }
  } catch (err) {
    console.error("[context-vault] Save failed:", err);
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "error",
        message: err instanceof Error ? err.message : "Save failed",
      } satisfies MessageType);
    }
  }
});

// ─── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        }),
      );
    return true; // Keep channel open for async response
  },
);

async function handleMessage(message: MessageType): Promise<MessageType> {
  switch (message.type) {
    case "search": {
      const result = await searchVault(message.query, {
        limit: message.limit || 10,
      });
      return {
        type: "search_result",
        results: result.results,
        query: result.query,
      };
    }

    case "capture": {
      const entry = await createEntry({
        kind: message.kind,
        body: message.body,
        title: message.title,
        tags: message.tags,
        source: message.source,
      });
      return { type: "capture_result", id: entry.id };
    }

    case "get_settings": {
      const stored = await chrome.storage.local.get([
        "serverUrl",
        "apiKey",
        "mode",
        "vaultPath",
      ]);
      const mode: VaultMode = stored.mode || DEFAULT_SETTINGS.mode;
      const serverUrl = stored.serverUrl || DEFAULT_SETTINGS.serverUrl;
      const apiKey = stored.apiKey || "";
      const vaultPath = stored.vaultPath || "";
      return {
        type: "settings",
        serverUrl,
        apiKey,
        mode,
        vaultPath,
        connected: isConnected(mode, serverUrl, apiKey, vaultPath),
      };
    }

    case "save_settings": {
      const serverUrl = message.serverUrl.trim().replace(/\/$/, "");
      const apiKey = message.apiKey.trim();
      const mode: VaultMode = message.mode;
      const vaultPath = message.vaultPath?.trim() || "";

      if (mode === "hosted") {
        if (!serverUrl) {
          return { type: "error", message: "Server URL is required" };
        }
        try {
          await ensureServerPermission(serverUrl);
        } catch (err) {
          return {
            type: "error",
            message:
              err instanceof Error ? err.message : "Permission request failed",
          };
        }
      }

      await chrome.storage.local.set({ serverUrl, apiKey, mode, vaultPath });
      clearSettingsCache();

      const connected = isConnected(mode, serverUrl, apiKey, vaultPath);
      updateBadge(connected);

      return {
        type: "settings",
        serverUrl,
        apiKey,
        mode,
        vaultPath,
        connected,
      };
    }

    case "test_connection": {
      try {
        const status = await getVaultStatus();
        const connected =
          status.health === "ok" || status.health === "degraded";
        updateBadge(connected);
        return { type: "connection_result", success: connected };
      } catch (err) {
        updateBadge(false);
        const code = (err as any)?.code || undefined;
        return {
          type: "connection_result",
          success: false,
          error: err instanceof Error ? err.message : "Connection failed",
          code,
        };
      }
    }

    case "check_health": {
      const stored = await chrome.storage.local.get([
        "mode",
        "serverUrl",
        "apiKey",
        "vaultPath",
      ]);
      const mode: VaultMode = stored.mode || DEFAULT_SETTINGS.mode;
      const reachable = await probeServer(3000);
      updateBadge(reachable);
      return { type: "health_result", reachable, mode };
    }

    default:
      return { type: "error", message: "Unknown message type" };
  }
}
