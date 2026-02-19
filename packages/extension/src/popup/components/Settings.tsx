import React, { useState, useEffect } from "react";
import type { MessageType } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";

interface Props {
  onSaved: (connected: boolean) => void;
}

export function Settings({ onSaved }: Props) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SETTINGS.serverUrl);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "get_settings" }, (response: MessageType) => {
      if (chrome.runtime.lastError) {
        console.warn("[context-vault]", chrome.runtime.lastError.message);
        return;
      }
      if (response?.type === "settings") {
        setServerUrl(response.serverUrl);
        setApiKey(response.apiKey);
      }
    });
  }, []);

  function handleSave() {
    chrome.runtime.sendMessage(
      { type: "save_settings", serverUrl, apiKey },
      (response: MessageType) => {
        if (chrome.runtime.lastError) {
          console.warn("[context-vault]", chrome.runtime.lastError.message);
          setTestResult({ success: false, error: "Could not reach background service." });
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
      }
    );
  }

  function handleTest() {
    setTesting(true);
    setTestResult(null);

    // Save first, then test
    chrome.runtime.sendMessage({ type: "save_settings", serverUrl, apiKey }, (saveResponse: MessageType) => {
      if (chrome.runtime.lastError) {
        console.warn("[context-vault]", chrome.runtime.lastError.message);
        setTesting(false);
        setTestResult({ success: false, error: "Could not reach background service." });
        return;
      }
      if (saveResponse?.type === "error") {
        setTesting(false);
        setTestResult({ success: false, error: saveResponse.message });
        return;
      }
      chrome.runtime.sendMessage({ type: "test_connection" }, (response: MessageType) => {
        if (chrome.runtime.lastError) {
          console.warn("[context-vault]", chrome.runtime.lastError.message);
          setTesting(false);
          setTestResult({ success: false, error: "Could not reach background service." });
          return;
        }
        setTesting(false);
        if (response?.type === "connection_result") {
          setTestResult(response);
        }
      });
    });
  }

  return (
    <div style={{ padding: "16px" }}>
      <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "16px" }}>Settings</h3>

      <label style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginBottom: "4px" }}>
        Server URL
      </label>
      <input
        type="url"
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
        placeholder="https://vault.yourdomain.com"
        style={{
          width: "100%", padding: "8px 12px", fontSize: "14px",
          backgroundColor: "#1e293b", border: "1px solid #334155",
          borderRadius: "6px", color: "#e2e8f0", outline: "none",
          marginBottom: "12px",
        }}
      />

      <label style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginBottom: "4px" }}>
        API Key
      </label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="cv_..."
        style={{
          width: "100%", padding: "8px 12px", fontSize: "14px",
          backgroundColor: "#1e293b", border: "1px solid #334155",
          borderRadius: "6px", color: "#e2e8f0", outline: "none",
          marginBottom: "16px",
        }}
      />

      {testResult && (
        <div style={{
          padding: "8px 12px", marginBottom: "12px", borderRadius: "6px", fontSize: "13px",
          backgroundColor: testResult.success ? "#052e16" : "#450a0a",
          color: testResult.success ? "#4ade80" : "#fca5a5",
        }}>
          {testResult.success ? "Connected successfully" : `Connection failed: ${testResult.error}`}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleTest}
          disabled={testing || !serverUrl || !apiKey}
          style={{
            flex: 1, padding: "8px 16px", fontSize: "14px",
            backgroundColor: "#334155", color: "#e2e8f0",
            border: "none", borderRadius: "6px",
            cursor: testing ? "wait" : "pointer",
          }}
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={handleSave}
          disabled={!serverUrl || !apiKey}
          style={{
            flex: 1, padding: "8px 16px", fontSize: "14px", fontWeight: 500,
            backgroundColor: "#3b82f6", color: "#fff",
            border: "none", borderRadius: "6px", cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
