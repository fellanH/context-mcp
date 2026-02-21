import { injectContentEditable, extractTextContent } from "./types";
import type { PlatformAdapter } from "./types";
import type { ChatMessage } from "@/shared/types";

const log = (...args: unknown[]) =>
  console.debug("[context-vault:generic]", ...args);

export const genericAdapter: PlatformAdapter = {
  name: "Generic",

  matches() {
    return true; // Fallback — always matches
  },

  getChatInput() {
    // Try contenteditable first, then textarea
    return (
      document.querySelector<HTMLElement>('[contenteditable="true"]') ||
      document.querySelector<HTMLElement>("textarea:not([readonly])") ||
      document.querySelector<HTMLElement>("input[type='text']:not([readonly])")
    );
  },

  injectText(text: string) {
    const input = this.getChatInput();
    if (!input) return false;

    input.focus();

    // For textarea/input elements — direct value manipulation
    if (
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLInputElement
    ) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + text.length;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    // For contenteditable — snapshot-and-verify injection chain
    return injectContentEditable(input, text);
  },

  getMessages(): ChatMessage[] {
    try {
      // Strategy 1: elements with explicit role attributes (data-role, data-message-role, etc.)
      const roleMarked = document.querySelectorAll<HTMLElement>(
        "[data-role], [data-message-role], [data-author], [data-message-author-role]",
      );
      if (roleMarked.length > 0) {
        const messages: ChatMessage[] = [];
        roleMarked.forEach((el) => {
          const rawRole =
            el.getAttribute("data-role") ||
            el.getAttribute("data-message-role") ||
            el.getAttribute("data-author") ||
            el.getAttribute("data-message-author-role") ||
            "";
          const role: "user" | "assistant" = /user|human/i.test(rawRole)
            ? "user"
            : "assistant";
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
          log(`strategy 1 (data-role attributes): ${messages.length} messages`);
          return messages;
        }
      }

      // Strategy 2: elements with chat/message class patterns
      const chatEls = document.querySelectorAll<HTMLElement>(
        '[class*="message"]:not(input):not(textarea), [class*="chat-bubble"], [class*="chat-message"]',
      );
      if (chatEls.length > 0) {
        // Filter to leaf-ish elements (skip wrappers that contain other matches)
        const filtered = Array.from(chatEls).filter(
          (el) =>
            el.querySelector('[class*="message"]') === null &&
            extractTextContent(el).length > 5,
        );
        if (filtered.length > 1) {
          const messages: ChatMessage[] = [];
          filtered.forEach((el, i) => {
            const content = extractTextContent(el);
            if (content) {
              // Try to detect role from class names
              const cls = el.className.toLowerCase();
              let role: "user" | "assistant";
              if (/user|human|sent|outgoing/.test(cls)) role = "user";
              else if (/assistant|bot|ai|received|incoming|response/.test(cls))
                role = "assistant";
              else role = i % 2 === 0 ? "user" : "assistant";
              messages.push({
                index: messages.length,
                role,
                content,
                platform: this.name,
              });
            }
          });
          if (messages.length > 0) {
            log(`strategy 2 (class patterns): ${messages.length} messages`);
            return messages;
          }
        }
      }

      // Strategy 3: article elements within main or role="main"
      const main =
        document.querySelector<HTMLElement>('[role="main"]') ||
        document.querySelector<HTMLElement>("main");
      if (main) {
        const articles = main.querySelectorAll<HTMLElement>("article");
        if (articles.length > 1) {
          const messages: ChatMessage[] = [];
          articles.forEach((article, i) => {
            const content = extractTextContent(article);
            if (content && content.length > 5) {
              messages.push({
                index: messages.length,
                role: i % 2 === 0 ? "user" : "assistant",
                content,
                platform: this.name,
              });
            }
          });
          if (messages.length > 0) {
            log(`strategy 3 (main > article): ${messages.length} messages`);
            return messages;
          }
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
