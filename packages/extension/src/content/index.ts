/**
 * Content script — runs on AI chat pages.
 * Handles text injection and message passing with the service worker.
 */

import { detectPlatform } from "./platforms/registry";
import type { MessageType } from "@/shared/types";

const platform = detectPlatform();

// ─── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    try {
      switch (message.type) {
        case "inject_text": {
          const success = platform.injectText(message.text);
          sendResponse({
            type: "inject_result",
            success,
          } satisfies MessageType);
          break;
        }

        case "get_messages": {
          const msgs = platform.getMessages();
          sendResponse({
            type: "messages_result",
            messages: msgs,
            platform: platform.name,
          } satisfies MessageType);
          break;
        }

        case "capture_result": {
          showNotification(
            `Saved to vault (${message.id.slice(0, 8)}...)`,
            "success",
          );
          break;
        }

        case "error": {
          showNotification(message.message, "error");
          break;
        }
      }
    } catch (err) {
      console.error("[context-vault:content]", err);
      sendResponse({
        type: "error",
        message: err instanceof Error ? err.message : "Content script error",
      } satisfies MessageType);
    }
    return false; // Synchronous response
  },
);

// ─── Notification Toast (Shadow DOM isolated) ───────────────────────────────

function showNotification(text: string, type: "success" | "error") {
  // Remove existing host to prevent duplicates
  const existing = document.getElementById("context-vault-host");
  if (existing) existing.remove();

  // Create Shadow DOM host — isolates toast styles from page CSS
  const host = document.createElement("div");
  host.id = "context-vault-host";
  Object.assign(host.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "999999",
  });

  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .toast {
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: #fff;
      background-color: ${type === "success" ? "#22c55e" : "#dc2626"};
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: opacity 0.3s ease;
      opacity: 1;
    }
  `;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;

  shadow.appendChild(style);
  shadow.appendChild(toast);
  document.body.appendChild(host);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => host.remove(), 300);
  }, 3000);
}
