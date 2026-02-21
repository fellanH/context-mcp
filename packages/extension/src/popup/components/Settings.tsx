import React, { useState, useEffect } from "react";
import { HardDrive, Cloud, FolderOpen } from "lucide-react";
import type { MessageType, VaultMode } from "@/shared/types";
import { DEFAULT_SETTINGS, LOCAL_DEFAULTS } from "@/shared/types";
import { cn } from "@/shared/cn";

interface Props {
  onSaved: (connected: boolean) => void;
}

export function Settings({ onSaved }: Props) {
  const [mode, setMode] = useState<VaultMode>(DEFAULT_SETTINGS.mode);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SETTINGS.serverUrl);
  const [apiKey, setApiKey] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

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
          setServerUrl(response.serverUrl);
          setApiKey(response.apiKey);
          setVaultPath(response.vaultPath);
        }
      },
    );
  }, []);

  function handleModeSwitch(newMode: VaultMode) {
    if (newMode === mode) return;
    setMode(newMode);
    setTestResult(null);
    if (newMode === "local") {
      setServerUrl(LOCAL_DEFAULTS.serverUrl);
      setApiKey("");
      setVaultPath(LOCAL_DEFAULTS.vaultPath);
    } else {
      setServerUrl(DEFAULT_SETTINGS.serverUrl);
      setApiKey("");
      setVaultPath("");
    }
  }

  async function handleBrowse() {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      setVaultPath(handle.name);
    } catch {
      // User cancelled or API unavailable
    }
  }

  function handleSave() {
    const effectiveUrl =
      mode === "local" ? LOCAL_DEFAULTS.serverUrl : serverUrl;
    chrome.runtime.sendMessage(
      {
        type: "save_settings",
        serverUrl: effectiveUrl,
        apiKey,
        mode,
        vaultPath,
      } satisfies MessageType,
      (response: MessageType) => {
        if (chrome.runtime.lastError) {
          setTestResult({
            success: false,
            error: "Could not reach background service.",
          });
          return;
        }
        if (response?.type === "error") {
          setTestResult({ success: false, error: response.message });
          return;
        }
        if (response?.type === "settings") {
          setTestResult({ success: true });
          onSaved(response.connected);
        }
      },
    );
  }

  function handleTest() {
    setTesting(true);
    setTestResult(null);

    const effectiveUrl =
      mode === "local" ? LOCAL_DEFAULTS.serverUrl : serverUrl;
    chrome.runtime.sendMessage(
      {
        type: "save_settings",
        serverUrl: effectiveUrl,
        apiKey,
        mode,
        vaultPath,
      } satisfies MessageType,
      (saveResponse: MessageType) => {
        if (chrome.runtime.lastError) {
          setTesting(false);
          setTestResult({
            success: false,
            error: "Could not reach background service.",
          });
          return;
        }
        if (saveResponse?.type === "error") {
          setTesting(false);
          setTestResult({ success: false, error: saveResponse.message });
          return;
        }
        chrome.runtime.sendMessage(
          { type: "test_connection" },
          (response: MessageType) => {
            if (chrome.runtime.lastError) {
              setTesting(false);
              setTestResult({
                success: false,
                error: "Could not reach background service.",
              });
              return;
            }
            setTesting(false);
            if (response?.type === "connection_result") {
              setTestResult(response);
            }
          },
        );
      },
    );
  }

  const isLocal = mode === "local";
  const canSave = isLocal ? Boolean(vaultPath) : Boolean(serverUrl && apiKey);

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold mb-3">Settings</h3>

      {/* Mode toggle */}
      <div className="flex rounded-lg bg-secondary/50 p-0.5 mb-4">
        {(["local", "hosted"] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeSwitch(m)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer",
              mode === m
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "local" ? (
              <HardDrive className="w-3 h-3" />
            ) : (
              <Cloud className="w-3 h-3" />
            )}
            {m === "local" ? "Local" : "Hosted"}
          </button>
        ))}
      </div>

      {/* Local mode — entries folder path */}
      {isLocal && (
        <>
          <label className="block text-xs text-muted-foreground mb-1">
            Entries Folder
          </label>
          <div className="flex gap-1.5 mb-1">
            <input
              type="text"
              value={vaultPath}
              onChange={(e) => setVaultPath(e.target.value)}
              placeholder={LOCAL_DEFAULTS.vaultPath}
              className="flex-1 px-3 py-2 text-sm bg-input-background border border-input rounded-lg text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleBrowse}
              title="Browse for entries folder"
              className="px-2.5 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Folder containing your vault markdown files
          </p>
          <div className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
            Requires{" "}
            <code className="bg-secondary px-1 py-0.5 rounded font-mono text-[11px]">
              context-vault ui
            </code>{" "}
            running in your terminal.
          </div>
        </>
      )}

      {/* Hosted mode — server URL + API key */}
      {!isLocal && (
        <>
          <label className="block text-xs text-muted-foreground mb-1">
            Server URL
          </label>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://app.context-vault.com"
            className="w-full px-3 py-2 text-sm bg-input-background border border-input rounded-lg text-foreground outline-none focus:ring-1 focus:ring-ring mb-3"
          />

          <label className="block text-xs text-muted-foreground mb-1">
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cv_..."
            className="w-full px-3 py-2 text-sm bg-input-background border border-input rounded-lg text-foreground outline-none focus:ring-1 focus:ring-ring mb-4"
          />
        </>
      )}

      {testResult && (
        <div
          className={`px-3 py-2 mb-3 rounded-lg text-sm ${
            testResult.success
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {testResult.success ? (
            "Connected successfully"
          ) : testResult.error?.includes("Local server is not running") ? (
            <div>
              <div className="font-medium mb-1">Local server not running</div>
              <div className="text-xs opacity-80">
                Run{" "}
                <code className="bg-secondary px-1 py-0.5 rounded font-mono">
                  context-vault ui
                </code>{" "}
                in your terminal to start the server.
              </div>
            </div>
          ) : (
            `Connection failed: ${testResult.error}`
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !canSave}
          className="flex-1 py-2 px-4 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="flex-1 py-2 px-4 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  );
}
