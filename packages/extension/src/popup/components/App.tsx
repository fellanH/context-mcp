import React, { useState, useEffect } from "react";
import { SearchBar } from "./SearchBar";
import { ResultList } from "./ResultList";
import { Settings } from "./Settings";
import type { SearchResult, MessageType } from "@/shared/types";

type View = "search" | "settings";

export function App() {
  const [view, setView] = useState<View>("search");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [rateLimitRemaining, setRateLimitRemaining] = useState<number | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "get_settings" }, (response: MessageType) => {
      if (chrome.runtime.lastError) {
        console.warn("[context-vault]", chrome.runtime.lastError.message);
        return;
      }
      if (response?.type === "settings") {
        setConnected(response.connected);
        if (!response.apiKey) setView("settings");
      }
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.get(["rateLimitRemaining", "rateLimitReset"], (stored) => {
      const reset = Number(stored.rateLimitReset);
      if (Number.isFinite(reset) && Date.now() > reset * 1000) {
        chrome.storage.local.remove(["rateLimitRemaining", "rateLimitReset"]);
        return;
      }
      const raw = stored.rateLimitRemaining;
      const parsed = raw !== undefined ? Number(raw) : Number.NaN;
      if (Number.isFinite(parsed)) {
        setRateLimitRemaining(parsed);
      }
    });

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes.rateLimitRemaining) return;
      const parsed = Number(changes.rateLimitRemaining.newValue);
      if (Number.isFinite(parsed)) {
        setRateLimitRemaining(parsed);
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  function handleSearch(q: string) {
    if (!q.trim()) return;
    setQuery(q);
    setLoading(true);
    setError(null);

    chrome.runtime.sendMessage({ type: "search", query: q, limit: 10 }, (response: MessageType) => {
      if (chrome.runtime.lastError) {
        console.warn("[context-vault]", chrome.runtime.lastError.message);
        setLoading(false);
        setError("Could not reach background service. Try reopening the popup.");
        return;
      }
      setLoading(false);
      if (response?.type === "search_result") {
        setResults(response.results);
      } else if (response?.type === "error") {
        setError(response.message);
      }
    });
  }

  function handleInject(text: string) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn("[context-vault]", chrome.runtime.lastError.message);
        return;
      }
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "inject_text", text });
        window.close();
      }
    });
  }

  const showRateLimitWarning =
    connected && rateLimitRemaining !== null && Number.isFinite(rateLimitRemaining) && rateLimitRemaining < 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px", fontWeight: 600 }}>Context Vault</span>
          <span style={{
            width: "8px", height: "8px", borderRadius: "50%",
            backgroundColor: connected ? "#22c55e" : "#ef4444",
          }} />
        </div>
        <button
          onClick={() => setView(view === "settings" ? "search" : "settings")}
          style={{
            background: "none", border: "none", color: "#94a3b8",
            cursor: "pointer", fontSize: "14px", padding: "4px 8px",
          }}
        >
          {view === "settings" ? "Back" : "Settings"}
        </button>
      </div>

      {showRateLimitWarning && (
        <div
          style={{
            backgroundColor: "#451a03",
            color: "#fcd34d",
            fontSize: "12px",
            padding: "8px 12px",
            borderBottom: "1px solid #78350f",
          }}
        >
          Rate limit almost reached ({rateLimitRemaining} requests left today).
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {view === "settings" ? (
          <Settings
            onSaved={(nextConnected) => {
              setView("search");
              setConnected(nextConnected);
            }}
          />
        ) : !connected ? (
          <div style={{ padding: "16px" }}>
            <div
              style={{
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "#0f172a",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
                Connect Your Vault
              </div>
              <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "12px", lineHeight: "1.4" }}>
                Add your server URL and API key in Settings before searching or injecting context.
              </div>
              <button
                onClick={() => setView("settings")}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Open Settings
              </button>
            </div>
          </div>
        ) : (
          <>
            <SearchBar onSearch={handleSearch} loading={loading} />
            {error && (
              <div style={{ padding: "12px 16px", color: "#ef4444", fontSize: "13px" }}>{error}</div>
            )}
            <ResultList results={results} query={query} onInject={handleInject} />
          </>
        )}
      </div>
    </div>
  );
}
