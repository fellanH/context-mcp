import React, { useState, useEffect } from "react";
import { Search, MessageSquare, Settings as SettingsIcon } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { ResultList } from "./ResultList";
import { Settings } from "./Settings";
import { CaptureView } from "./CaptureView";
import { ErrorBoundary } from "./ErrorBoundary";
import type { SearchResult, MessageType, VaultMode } from "@/shared/types";

type View = "search" | "capture" | "settings";

const TABS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "search", label: "Search", icon: <Search className="w-3.5 h-3.5" /> },
  {
    id: "capture",
    label: "Capture",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <SettingsIcon className="w-3.5 h-3.5" />,
  },
];

export function App() {
  const [view, setView] = useState<View>("search");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [serverOffline, setServerOffline] = useState(false);
  const [mode, setMode] = useState<VaultMode>("hosted");
  const [rateLimitRemaining, setRateLimitRemaining] = useState<number | null>(
    null,
  );

  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: "get_settings" },
      (response: MessageType) => {
        if (chrome.runtime.lastError) {
          console.warn("[context-vault]", chrome.runtime.lastError.message);
          return;
        }
        if (response?.type === "settings") {
          setMode(response.mode);
          if (!response.connected) {
            setConnected(false);
            setView("settings");
            return;
          }
          // Settings say "connected" — but verify the server is actually reachable
          chrome.runtime.sendMessage(
            { type: "check_health" },
            (health: MessageType) => {
              if (chrome.runtime.lastError) return;
              if (health?.type === "health_result") {
                setConnected(health.reachable);
                setServerOffline(!health.reachable);
                setMode(health.mode);
              }
            },
          );
        }
      },
    );
  }, []);

  useEffect(() => {
    chrome.storage.local.get(
      ["rateLimitRemaining", "rateLimitReset"],
      (stored) => {
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
      },
    );

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
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

    chrome.runtime.sendMessage(
      { type: "search", query: q, limit: 10 },
      (response: MessageType) => {
        if (chrome.runtime.lastError) {
          console.warn("[context-vault]", chrome.runtime.lastError.message);
          setLoading(false);
          setError(
            "Could not reach background service. Try reopening the popup.",
          );
          return;
        }
        setLoading(false);
        if (response?.type === "search_result") {
          setResults(response.results);
          setServerOffline(false);
        } else if (response?.type === "error") {
          // Detect server-offline errors and show the banner instead of inline error
          if (response.message.includes("Local server is not running")) {
            setServerOffline(true);
            setConnected(false);
          } else {
            setError(response.message);
          }
        }
      },
    );
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
    connected &&
    rateLimitRemaining !== null &&
    Number.isFinite(rateLimitRemaining) &&
    rateLimitRemaining < 10;

  return (
    <div className="flex flex-col w-[400px] min-h-[500px]">
      {/* Header */}
      <div className="px-4 pt-3 pb-0 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">Context Vault</span>
            <span
              className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-destructive"}`}
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-secondary/50 rounded-lg p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                view === tab.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
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
          <ErrorBoundary label="Settings">
            <Settings
              onSaved={(nextConnected) => {
                setView("search");
                setConnected(nextConnected);
                setServerOffline(!nextConnected);
              }}
            />
          </ErrorBoundary>
        ) : view === "capture" ? (
          <ErrorBoundary label="Capture">
            <CaptureView
              connected={connected}
              serverOffline={serverOffline}
              mode={mode}
            />
          </ErrorBoundary>
        ) : serverOffline ? (
          <div className="p-4">
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-sm font-semibold mb-2">
                {mode === "local"
                  ? "Local Server Not Running"
                  : "Server Unreachable"}
              </div>
              <div className="text-sm text-muted-foreground mb-3 leading-snug">
                {mode === "local" ? (
                  <>
                    The extension needs the local server to search your vault.
                    Start it by running:
                    <code className="block mt-2 mb-2 px-3 py-2 bg-secondary rounded-lg text-xs text-foreground font-mono">
                      context-vault ui
                    </code>
                    This starts the server at{" "}
                    <span className="text-foreground">localhost:3141</span> and
                    opens the dashboard.
                  </>
                ) : (
                  "Could not reach the vault server. Check your connection and server URL in Settings."
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    chrome.runtime.sendMessage(
                      { type: "check_health" },
                      (health: MessageType) => {
                        if (chrome.runtime.lastError) return;
                        if (
                          health?.type === "health_result" &&
                          health.reachable
                        ) {
                          setConnected(true);
                          setServerOffline(false);
                        }
                      },
                    );
                  }}
                  className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors cursor-pointer"
                >
                  Retry Connection
                </button>
                <button
                  onClick={() => setView("settings")}
                  className="py-2 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground bg-secondary hover:bg-secondary/80 transition-colors cursor-pointer"
                >
                  Settings
                </button>
              </div>
            </div>
          </div>
        ) : !connected ? (
          <div className="p-4">
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-sm font-semibold mb-2">
                Connect Your Vault
              </div>
              <div className="text-sm text-muted-foreground mb-3 leading-snug">
                Configure your vault connection in Settings to start searching
                and injecting context.
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
          <ErrorBoundary label="Search">
            <SearchBar onSearch={handleSearch} loading={loading} />
            {error && (
              <div className="px-4 py-3 text-sm text-destructive">{error}</div>
            )}
            <ResultList
              results={results}
              query={query}
              onInject={handleInject}
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
