/** Vault entry as returned by the REST API */
export interface Entry {
  id: string;
  kind: string;
  category: "knowledge" | "entity" | "event";
  title: string | null;
  body: string | null;
  tags: string[];
  meta: Record<string, unknown>;
  source: string | null;
  identity_key: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface SearchResult extends Entry {
  score: number;
}

/** A single chat message extracted from an AI conversation */
export interface ChatMessage {
  index: number;
  role: "user" | "assistant";
  content: string;
  platform: string;
}

/** Vault connection mode */
export type VaultMode = "local" | "hosted";

/** Messages between popup/content scripts and background service worker */
export type MessageType =
  | { type: "search"; query: string; limit?: number }
  | { type: "search_result"; results: SearchResult[]; query: string }
  | { type: "inject_text"; text: string }
  | { type: "inject_result"; success: boolean }
  | { type: "get_messages" }
  | { type: "messages_result"; messages: ChatMessage[]; platform: string }
  | {
      type: "capture";
      kind: string;
      body: string;
      title?: string;
      tags?: string[];
      source?: string;
    }
  | { type: "capture_result"; id: string }
  | { type: "get_settings" }
  | {
      type: "settings";
      serverUrl: string;
      apiKey: string;
      connected: boolean;
      mode: VaultMode;
      vaultPath: string;
    }
  | {
      type: "save_settings";
      serverUrl: string;
      apiKey: string;
      mode: VaultMode;
      vaultPath: string;
    }
  | { type: "test_connection" }
  | {
      type: "connection_result";
      success: boolean;
      error?: string;
      code?: string;
    }
  | { type: "check_health" }
  | { type: "health_result"; reachable: boolean; mode: VaultMode }
  | { type: "error"; message: string };

/** Extension storage shape */
export interface ExtensionSettings {
  serverUrl: string;
  apiKey: string;
  mode: VaultMode;
  vaultPath: string;
  encryptionSecret?: string;
}

/** Default settings */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: "https://api.context-vault.com",
  apiKey: "",
  mode: "hosted",
  vaultPath: "",
};

/** Defaults when switching to local mode */
export const LOCAL_DEFAULTS = {
  serverUrl: "http://localhost:3141",
  apiKey: "",
  vaultPath: "~/.context-vault/entries",
} as const;
