import React, { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { VaultMode, MessageType } from "@/shared/types";
import { LOCAL_DEFAULTS } from "@/shared/types";

interface Props {
  mode: VaultMode;
  serverUrl: string;
  apiKey: string;
  vaultPath: string;
  onServerUrlChange: (url: string) => void;
  onApiKeyChange: (key: string) => void;
  onVaultPathChange: (path: string) => void;
  onConnected: () => void;
}

export function ConnectStep({
  mode,
  serverUrl,
  apiKey,
  vaultPath,
  onServerUrlChange,
  onApiKeyChange,
  onVaultPathChange,
  onConnected,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

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
          { type: "test_connection" } satisfies MessageType,
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
              if (response.success) {
                setTimeout(() => onConnected(), 800);
              }
            }
          },
        );
      },
    );
  }

  async function handleBrowse() {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      onVaultPathChange(handle.name);
    } catch {
      // User cancelled or API unavailable
    }
  }

  const isLocal = mode === "local";
  const canTest = isLocal ? Boolean(vaultPath) : Boolean(serverUrl && apiKey);

  return (
    <div className="w-full max-w-[480px] px-8 py-12">
      <h2 className="text-2xl font-bold mb-2">
        {isLocal ? "Locate Your Vault" : "Connect Your Vault"}
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        {isLocal
          ? "Select the directory where your vault data lives."
          : "Enter your Context Vault server details to get started."}
      </p>

      {/* Local mode — vault path only */}
      {isLocal && (
        <>
          <div className="bg-card border border-border rounded-xl p-4 mb-6 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Setup steps</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Install:{" "}
                <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                  npm i -g context-vault
                </code>
              </li>
              <li>
                Setup:{" "}
                <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                  context-vault setup
                </code>
              </li>
              <li>
                Start server:{" "}
                <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                  context-vault ui
                </code>
              </li>
            </ol>
            <p className="text-xs text-muted-foreground/70 pt-1">
              The extension connects to the local server at{" "}
              <code className="bg-secondary px-1 py-0.5 rounded text-[11px]">
                localhost:3141
              </code>
              . Keep it running while using the extension.
            </p>
          </div>

          <label className="block text-xs text-muted-foreground mb-1">
            Entries Folder
          </label>
          <div className="flex gap-2 mb-1">
            <input
              type="text"
              value={vaultPath}
              onChange={(e) => onVaultPathChange(e.target.value)}
              placeholder={LOCAL_DEFAULTS.vaultPath}
              className="flex-1 px-3.5 py-2.5 text-sm bg-input-background border border-input rounded-xl text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleBrowse}
              title="Browse for entries folder"
              className="px-3 py-2.5 bg-secondary text-secondary-foreground rounded-xl hover:bg-secondary/80 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            Folder containing your vault markdown files
          </p>
        </>
      )}

      {/* Hosted mode — server URL + API key */}
      {!isLocal && (
        <>
          <a
            href="https://github.com/fellanH/context-vault/blob/main/docs/distribution/connect-in-2-minutes.md"
            target="_blank"
            rel="noreferrer"
            className="inline-block mb-4 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Open setup guide
          </a>

          <label className="block text-xs text-muted-foreground mb-1">
            Server URL
          </label>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => onServerUrlChange(e.target.value)}
            placeholder="https://app.context-vault.com"
            className="w-full px-3.5 py-2.5 text-sm bg-input-background border border-input rounded-xl text-foreground outline-none focus:ring-1 focus:ring-ring mb-4"
          />

          <label className="block text-xs text-muted-foreground mb-1">
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="cv_..."
            className="w-full px-3.5 py-2.5 text-sm bg-input-background border border-input rounded-xl text-foreground outline-none focus:ring-1 focus:ring-ring mb-5"
          />
        </>
      )}

      {testResult && (
        <div
          className={`px-3.5 py-2.5 mb-4 rounded-xl text-sm ${
            testResult.success
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {testResult.success ? (
            "Connected successfully!"
          ) : testResult.error?.includes("Local server is not running") ? (
            <div>
              <div className="font-medium mb-1">Local server not running</div>
              <div className="text-xs opacity-80">
                Open a terminal and run{" "}
                <code className="bg-secondary px-1 py-0.5 rounded font-mono">
                  context-vault ui
                </code>{" "}
                first, then try again.
              </div>
            </div>
          ) : (
            `Connection failed: ${testResult.error}`
          )}
        </div>
      )}

      <button
        onClick={handleTest}
        disabled={testing || !canTest}
        className="w-full py-3 text-[15px] font-medium bg-foreground text-background rounded-xl hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {testing ? "Testing..." : isLocal ? "Verify Vault" : "Test Connection"}
      </button>
    </div>
  );
}
