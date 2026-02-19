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
        if (!response.connected) setView("settings");
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
    <div className="flex flex-col w-[400px] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Context Vault</span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-destructive"}`}
          />
        </div>
        <button
          onClick={() => setView(view === "settings" ? "search" : "settings")}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 cursor-pointer"
        >
          {view === "settings" ? "Back" : "Settings"}
        </button>
      </div>

      {/* Rate limit warning */}
      {showRateLimitWarning && (
        <div className="bg-warning/10 text-warning text-xs px-3 py-2 border-b border-warning/20">
          Rate limit almost reached ({rateLimitRemaining} requests left today).
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === "settings" ? (
          <Settings
            onSaved={(nextConnected) => {
              setView("search");
              setConnected(nextConnected);
            }}
          />
        ) : !connected ? (
          <div className="p-4">
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-sm font-semibold mb-2">Connect Your Vault</div>
              <div className="text-sm text-muted-foreground mb-3 leading-snug">
                Configure your vault connection in Settings to start searching and injecting context.
              </div>
              <button
                onClick={() => setView("settings")}
                className="w-full py-2 px-3 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors cursor-pointer"
              >
                Open Settings
              </button>
            </div>
          </div>
        ) : (
          <>
            <SearchBar onSearch={handleSearch} loading={loading} />
            {error && (
              <div className="px-4 py-3 text-sm text-destructive">{error}</div>
            )}
            <ResultList results={results} query={query} onInject={handleInject} />
          </>
        )}
      </div>
    </div>
  );
}
