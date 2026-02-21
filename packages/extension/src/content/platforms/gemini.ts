import { injectContentEditable, extractTextContent } from "./types";
import type { PlatformAdapter } from "./types";
import type { ChatMessage } from "@/shared/types";

const log = (...args: unknown[]) =>
  console.debug("[context-vault:gemini]", ...args);

export const geminiAdapter: PlatformAdapter = {
  name: "Gemini",

  matches() {
    return location.hostname === "gemini.google.com";
  },

  getChatInput() {
    // Fallback selector chain for Gemini's rich text editor
    return (
      document.querySelector<HTMLElement>(
        '.ql-editor[contenteditable="true"]',
      ) ||
      document.querySelector<HTMLElement>(
        'div[contenteditable="true"][role="textbox"]',
      ) ||
      document.querySelector<HTMLElement>(
        'rich-textarea [contenteditable="true"]',
      ) ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  },

  injectText(text: string) {
    const input = this.getChatInput();
    if (!input) {
      log("injectText failed: no chat input found");
      return false;
    }
    return injectContentEditable(input, text);
  },

  getMessages(): ChatMessage[] {
    try {
      // Strategy 1: custom elements (user-query / model-response)
      const userQueries = Array.from(
        document.querySelectorAll<HTMLElement>("user-query"),
      );
      const modelResponses = Array.from(
        document.querySelectorAll<HTMLElement>("model-response"),
      );
      if (userQueries.length > 0 || modelResponses.length > 0) {
        const tagged: { el: HTMLElement; role: "user" | "assistant" }[] = [
          ...userQueries.map((el) => ({ el, role: "user" as const })),
          ...modelResponses.map((el) => ({ el, role: "assistant" as const })),
        ];
        tagged.sort((a, b) => {
          const pos = a.el.compareDocumentPosition(b.el);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        const messages: ChatMessage[] = [];
        for (const { el, role } of tagged) {
          const content = extractTextContent(el);
          if (content) {
            messages.push({
              index: messages.length,
              role,
              content,
              platform: this.name,
            });
          }
        }
        if (messages.length > 0) {
          log(`strategy 1 (custom elements): ${messages.length} messages`);
          return messages;
        }
      }

      // Strategy 2: Angular chat turns — try both selectors independently
      // (querySelectorAll never returns null, so || fallback doesn't work)
      let chatTurns = document.querySelectorAll<HTMLElement>("ms-chat-turn");
      if (chatTurns.length === 0) {
        chatTurns = document.querySelectorAll<HTMLElement>(
          '[class*="chat-turn"]',
        );
      }
      if (chatTurns.length > 0) {
        const messages: ChatMessage[] = [];
        chatTurns.forEach((turn, i) => {
          const content = extractTextContent(turn);
          if (content) {
            messages.push({
              index: messages.length,
              role: i % 2 === 0 ? "user" : "assistant",
              content,
              platform: this.name,
            });
          }
        });
        if (messages.length > 0) {
          log(`strategy 2 (chat turns): ${messages.length} messages`);
          return messages;
        }
      }

      // Strategy 3: message-content class elements
      const msgEls = document.querySelectorAll<HTMLElement>(".message-content");
      if (msgEls.length > 0) {
        const messages: ChatMessage[] = [];
        msgEls.forEach((el, i) => {
          const content = extractTextContent(el);
          if (content) {
            messages.push({
              index: messages.length,
              role: i % 2 === 0 ? "user" : "assistant",
              content,
              platform: this.name,
            });
          }
        });
        if (messages.length > 0) {
          log(`strategy 3 (message-content): ${messages.length} messages`);
          return messages;
        }
      }

      log("no messages found with any strategy");
      return [];
    } catch (err) {
      log("getMessages error:", err);
      return [];
    }
  },
};
