import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import type { ChatMessage, MessageType, VaultMode } from "@/shared/types";

type CaptureState = "idle" | "loading" | "saving" | "done";

interface Props {
  connected: boolean;
  serverOffline: boolean;
  mode: VaultMode;
}

export function CaptureView({ connected, serverOffline }: Props) {
  const [state, setState] = useState<CaptureState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [platform, setPlatform] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extractError, setExtractError] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  const extract = useCallback(() => {
    setState("loading");
    setExtractError(null);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs[0]?.id) {
        setExtractError("Make sure you're on a supported AI chat site.");
        setState("idle");
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "get_messages" } satisfies MessageType,
        (response: MessageType) => {
          if (chrome.runtime.lastError) {
            setExtractError("Make sure you're on a supported AI chat site.");
            setState("idle");
            return;
          }
          if (response?.type === "messages_result") {
            setMessages(response.messages);
            setPlatform(response.platform);
            // Default: select all assistant messages
            setSelected(
              new Set(
                response.messages
                  .filter((m) => m.role === "assistant")
                  .map((m) => m.index),
              ),
            );
            setState("idle");
          } else {
            setExtractError("Unexpected response from content script.");
            setState("idle");
          }
        },
      );
    });
  }, []);

  useEffect(() => {
    extract();
  }, [extract]);

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === messages.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(messages.map((m) => m.index)));
    }
  }

  async function handleSave() {
    const toSave = messages.filter((m) => selected.has(m.index));
    if (toSave.length === 0) return;

    setState("saving");
    setSaveProgress({ done: 0, total: toSave.length });
    setSaveErrors([]);

    const errors: string[] = [];

    for (let i = 0; i < toSave.length; i++) {
      const msg = toSave[i];
      try {
        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "capture",
              kind: "reference",
              title:
                msg.content.slice(0, 80) +
                (msg.content.length > 80 ? "..." : ""),
              body: msg.content,
              tags: ["captured", "ai-chat", platform.toLowerCase()],
              source: "browser-extension",
            } satisfies MessageType,
            (response: MessageType) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (response?.type === "error") {
                reject(new Error(response.message));
                return;
              }
              resolve();
            },
          );
        });
      } catch (err) {
        errors.push(
          `Message ${msg.index + 1}: ${err instanceof Error ? err.message : "Failed"}`,
        );
      }
      setSaveProgress({ done: i + 1, total: toSave.length });
    }

    setSaveErrors(errors);
    setState("done");
  }

  // Not connected states
  if (!connected || serverOffline) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Connect your vault in Settings to capture messages.
      </div>
    );
  }

  // Done state
  if (state === "done") {
    const savedCount = saveProgress.total - saveErrors.length;
    return (
      <div className="p-4">
        <div className="border border-border rounded-xl p-4 bg-card text-center">
          {saveErrors.length === 0 ? (
            <>
              <Check className="w-8 h-8 text-success mx-auto mb-2" />
              <div className="text-sm font-semibold">
                Saved {savedCount} message{savedCount !== 1 ? "s" : ""} to vault
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="w-8 h-8 text-warning mx-auto mb-2" />
              <div className="text-sm font-semibold mb-1">
                Saved {savedCount} of {saveProgress.total} messages
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                {saveErrors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </>
          )}
          <button
            onClick={() => {
              setState("idle");
              extract();
            }}
            className="mt-3 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            Capture More
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (state === "loading") {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        Extracting messages...
      </div>
    );
  }

  // Error state (extraction failed)
  if (extractError) {
    return (
      <div className="p-4">
        <div className="border border-border rounded-xl p-4 bg-card">
          <div className="text-sm text-muted-foreground mb-3">
            {extractError}
          </div>
          <button
            onClick={extract}
            className="w-full py-2 px-3 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (messages.length === 0) {
    return (
      <div className="p-4">
        <div className="border border-border rounded-xl p-4 bg-card text-center">
          <div className="text-sm text-muted-foreground mb-3">
            No messages found. Start a conversation first.
          </div>
          <button
            onClick={extract}
            className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Message list
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground">
          {messages.length} message{messages.length !== 1 ? "s" : ""} from{" "}
          {platform}
        </span>
        <button
          onClick={extract}
          disabled={state === "saving"}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Select all */}
      <label className="flex items-center gap-2 px-4 py-2 border-b border-border text-xs cursor-pointer hover:bg-secondary/30">
        <input
          type="checkbox"
          checked={selected.size === messages.length}
          onChange={toggleAll}
          className="rounded"
        />
        <span className="text-muted-foreground">Select all</span>
      </label>

      {/* Message list */}
      <div className="flex-1 overflow-auto">
        {messages.map((msg) => (
          <label
            key={msg.index}
            className="flex gap-3 px-4 py-2.5 border-b border-border/50 cursor-pointer hover:bg-secondary/30"
          >
            <input
              type="checkbox"
              checked={selected.has(msg.index)}
              onChange={() => toggleSelect(msg.index)}
              className="mt-0.5 rounded flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <span
                className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-1 ${
                  msg.role === "user"
                    ? "bg-secondary text-muted-foreground"
                    : "bg-success/15 text-success"
                }`}
              >
                {msg.role === "user" ? "You" : "Assistant"}
              </span>
              <div className="text-xs text-foreground/80 leading-snug line-clamp-3">
                {msg.content.length > 120
                  ? msg.content.slice(0, 120) + "..."
                  : msg.content}
              </div>
            </div>
          </label>
        ))}
      </div>

      {/* Save bar */}
      <div className="border-t border-border px-4 py-3 bg-background">
        <button
          onClick={handleSave}
          disabled={selected.size === 0 || state === "saving"}
          className="w-full py-2.5 px-3 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === "saving"
            ? `Saving... (${saveProgress.done}/${saveProgress.total})`
            : `Save ${selected.size} message${selected.size !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
