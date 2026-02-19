import React, { useState } from "react";
import type { MessageType } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";

type Step = "welcome" | "connect" | "done";

export function Onboarding() {
  const [step, setStep] = useState<Step>("welcome");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SETTINGS.serverUrl);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  function handleTest() {
    setTesting(true);
    setTestResult(null);
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
          if (response.success) {
            setTimeout(() => setStep("done"), 800);
          }
        }
      });
    });
  }

  const containerStyle: React.CSSProperties = {
    maxWidth: "480px",
    width: "100%",
    padding: "48px 32px",
  };

  if (step === "welcome") {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: "36px", fontWeight: 700, marginBottom: "8px" }}>Context Vault</div>
        <div style={{ fontSize: "16px", color: "#94a3b8", marginBottom: "32px" }}>
          Your knowledge, always within reach.
        </div>
        <ul style={{ listStyle: "none", marginBottom: "32px" }}>
          {[
            ["Search", "Find relevant context from your vault and inject it directly into AI chats"],
            ["Save", "Right-click any text on a webpage to save it as an insight, note, or reference"],
            ["Connect", "Works with ChatGPT, Claude, and Gemini — plus any text input"],
          ].map(([title, desc]) => (
            <li key={title} style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <div style={{
                width: "32px", height: "32px", borderRadius: "8px",
                backgroundColor: "#1e293b", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0, fontSize: "14px", fontWeight: 600,
                color: "#3b82f6",
              }}>
                {title[0]}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: "2px" }}>{title}</div>
                <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: "1.4" }}>{desc}</div>
              </div>
            </li>
          ))}
        </ul>
        <button
          onClick={() => setStep("connect")}
          style={{
            width: "100%", padding: "12px", fontSize: "15px", fontWeight: 500,
            backgroundColor: "#3b82f6", color: "#fff",
            border: "none", borderRadius: "8px", cursor: "pointer",
          }}
        >
          Get Started
        </button>
      </div>
    );
  }

  if (step === "connect") {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>Connect Your Vault</div>
        <div style={{ fontSize: "14px", color: "#94a3b8", marginBottom: "24px" }}>
          Enter your Context Vault server details to get started.
        </div>
        <a
          href="https://github.com/fellanH/context-mcp/blob/main/docs/distribution/connect-in-2-minutes.md"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            marginBottom: "16px",
            fontSize: "12px",
            color: "#93c5fd",
            textDecoration: "none",
          }}
        >
          Open setup guide
        </a>

        <label style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginBottom: "4px" }}>
          Server URL
        </label>
        <input
          type="url"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://vault.yourdomain.com"
          style={{
            width: "100%", padding: "10px 14px", fontSize: "14px",
            backgroundColor: "#1e293b", border: "1px solid #334155",
            borderRadius: "8px", color: "#e2e8f0", outline: "none",
            marginBottom: "16px",
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
            width: "100%", padding: "10px 14px", fontSize: "14px",
            backgroundColor: "#1e293b", border: "1px solid #334155",
            borderRadius: "8px", color: "#e2e8f0", outline: "none",
            marginBottom: "20px",
          }}
        />

        {testResult && (
          <div style={{
            padding: "10px 14px", marginBottom: "16px", borderRadius: "8px", fontSize: "13px",
            backgroundColor: testResult.success ? "#052e16" : "#450a0a",
            color: testResult.success ? "#4ade80" : "#fca5a5",
          }}>
            {testResult.success ? "Connected successfully!" : `Connection failed: ${testResult.error}`}
          </div>
        )}

        <button
          onClick={handleTest}
          disabled={testing || !serverUrl || !apiKey}
          style={{
            width: "100%", padding: "12px", fontSize: "15px", fontWeight: 500,
            backgroundColor: "#3b82f6", color: "#fff",
            border: "none", borderRadius: "8px",
            cursor: testing ? "wait" : "pointer",
            opacity: (!serverUrl || !apiKey) ? 0.5 : 1,
          }}
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>
    );
  }

  // Done step
  return (
    <div style={{ ...containerStyle, textAlign: "center" }}>
      <div style={{ fontSize: "48px", marginBottom: "16px" }}>✓</div>
      <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>You're All Set!</div>
      <div style={{ fontSize: "14px", color: "#94a3b8", marginBottom: "32px", lineHeight: "1.5" }}>
        Context Vault is ready to use.
      </div>
      <div style={{
        textAlign: "left", backgroundColor: "#1e293b", borderRadius: "12px",
        padding: "20px", marginBottom: "24px",
      }}>
        <div style={{ fontWeight: 600, marginBottom: "12px" }}>Quick tips</div>
        <ul style={{ listStyle: "none", fontSize: "13px", color: "#94a3b8" }}>
          <li style={{ marginBottom: "8px" }}>
            Press <kbd style={{ backgroundColor: "#334155", padding: "2px 6px", borderRadius: "4px", fontSize: "12px", color: "#e2e8f0" }}>Ctrl+Shift+Space</kbd> (or <kbd style={{ backgroundColor: "#334155", padding: "2px 6px", borderRadius: "4px", fontSize: "12px", color: "#e2e8f0" }}>⌘+Shift+Space</kbd>) to open the popup
          </li>
          <li style={{ marginBottom: "8px" }}>
            Right-click selected text to save it to your vault
          </li>
          <li>
            Search results can be injected directly into any AI chat
          </li>
        </ul>
      </div>
      <button
        onClick={() => window.close()}
        style={{
          padding: "12px 32px", fontSize: "15px", fontWeight: 500,
          backgroundColor: "#3b82f6", color: "#fff",
          border: "none", borderRadius: "8px", cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}
