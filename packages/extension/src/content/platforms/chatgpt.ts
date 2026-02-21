import { injectContentEditable, extractTextContent } from "./types";
import type { PlatformAdapter } from "./types";
import type { ChatMessage } from "@/shared/types";

const log = (...args: unknown[]) =>
  console.debug("[context-vault:chatgpt]", ...args);

export const chatgptAdapter: PlatformAdapter = {
  name: "ChatGPT",

  matches() {
    return (
      location.hostname === "chatgpt.com" ||
      location.hostname === "chat.openai.com"
    );
  },

  getChatInput() {
    // Fallback selector chain for ChatGPT's prompt textarea
    return (
      document.querySelector<HTMLElement>("#prompt-textarea") ||
      document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]') ||
      document.querySelector<HTMLElement>(
        'div[contenteditable][role="textbox"]',
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
      // Strategy 1: data-testid conversation turns with explicit role attributes
      const turns = document.querySelectorAll<HTMLElement>(
        '[data-testid^="conversation-turn-"]',
      );
      if (turns.length > 0) {
        const messages: ChatMessage[] = [];
        turns.forEach((turn) => {
          const roleEl = turn.querySelector<HTMLElement>(
            "[data-message-author-role]",
          );
          const rawRole = roleEl?.getAttribute("data-message-author-role");
          const role: "user" | "assistant" =
            rawRole === "user" ? "user" : "assistant";
          const content = extractTextContent(turn);
          if (content) {
            messages.push({
              index: messages.length,
              role,
              content,
              platform: this.name,
            });
          }
        });
        if (messages.length > 0) {
          log(`strategy 1 (data-testid turns): ${messages.length} messages`);
          return messages;
        }
      }

      // Strategy 2: article elements within [role="presentation"] (newer ChatGPT layout)
      const presentation = document.querySelectorAll<HTMLElement>(
        '[role="presentation"] article',
      );
      if (presentation.length > 0) {
        const messages: ChatMessage[] = [];
        presentation.forEach((el) => {
          const roleEl =
            el.closest<HTMLElement>("[data-message-author-role]") ||
            el.querySelector<HTMLElement>("[data-message-author-role]");
          const rawRole = roleEl?.getAttribute("data-message-author-role");
          const role: "user" | "assistant" =
            rawRole === "user" ? "user" : "assistant";
          const content = extractTextContent(el);
          if (content) {
            messages.push({
              index: messages.length,
              role,
              content,
              platform: this.name,
            });
          }
        });
        if (messages.length > 0) {
          log(
            `strategy 2 (presentation articles): ${messages.length} messages`,
          );
          return messages;
        }
      }

      // Strategy 3: main article elements (positional fallback)
      const articles = document.querySelectorAll<HTMLElement>("main article");
      if (articles.length > 0) {
        const messages: ChatMessage[] = [];
        articles.forEach((article, i) => {
          const content = extractTextContent(article);
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
          log(
            `strategy 3 (main articles, positional): ${messages.length} messages`,
          );
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
