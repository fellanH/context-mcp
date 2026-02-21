import { injectContentEditable, extractTextContent } from "./types";
import type { PlatformAdapter } from "./types";
import type { ChatMessage } from "@/shared/types";

const log = (...args: unknown[]) =>
  console.debug("[context-vault:claude]", ...args);

/** Sort nodes by DOM order using compareDocumentPosition */
function sortByDomOrder(nodes: HTMLElement[]): HTMLElement[] {
  return nodes.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

/** Extract messages from tagged user/assistant elements, sorted by DOM order */
function extractTaggedMessages(
  userEls: HTMLElement[],
  assistantEls: HTMLElement[],
  platform: string,
): ChatMessage[] | null {
  if (userEls.length === 0 && assistantEls.length === 0) return null;
  const tagged: { el: HTMLElement; role: "user" | "assistant" }[] = [
    ...userEls.map((el) => ({ el, role: "user" as const })),
    ...assistantEls.map((el) => ({ el, role: "assistant" as const })),
  ];
  const sorted = sortByDomOrder(tagged.map((t) => t.el));
  const roleMap = new Map(tagged.map((t) => [t.el, t.role]));
  const messages: ChatMessage[] = [];
  for (const el of sorted) {
    const content = extractTextContent(el);
    if (content) {
      messages.push({
        index: messages.length,
        role: roleMap.get(el)!,
        content,
        platform,
      });
    }
  }
  return messages.length > 0 ? messages : null;
}

export const claudeAdapter: PlatformAdapter = {
  name: "Claude",

  matches() {
    return location.hostname === "claude.ai";
  },

  getChatInput() {
    // Fallback selector chain for Claude's ProseMirror editor
    return (
      document.querySelector<HTMLElement>(
        '[contenteditable="true"].ProseMirror',
      ) ||
      document.querySelector<HTMLElement>("div.ProseMirror[contenteditable]") ||
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
      // Strategy 1: data-testid based selectors
      const result1 = extractTaggedMessages(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid="user-message"]',
          ),
        ),
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid="assistant-message"]',
          ),
        ),
        this.name,
      );
      if (result1) {
        log(`strategy 1 (data-testid): ${result1.length} messages`);
        return result1;
      }

      // Strategy 2: class-based selectors
      const result2 = extractTaggedMessages(
        Array.from(
          document.querySelectorAll<HTMLElement>(".font-user-message"),
        ),
        Array.from(
          document.querySelectorAll<HTMLElement>(".font-claude-message"),
        ),
        this.name,
      );
      if (result2) {
        log(`strategy 2 (class-based): ${result2.length} messages`);
        return result2;
      }

      // Strategy 3: data-is-streaming container children (newer Claude layout)
      const result3 = extractTaggedMessages(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-is-streaming] .human-turn, [data-testid="human-turn"]',
          ),
        ),
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-is-streaming] .ai-turn, [data-testid="ai-turn"]',
          ),
        ),
        this.name,
      );
      if (result3) {
        log(`strategy 3 (streaming container): ${result3.length} messages`);
        return result3;
      }

      // Strategy 4: positional fallback — conversation container children
      const container =
        document.querySelector<HTMLElement>('[class*="conversation"]') ||
        document.querySelector<HTMLElement>("main");
      if (container) {
        const children = Array.from(container.children) as HTMLElement[];
        const messages: ChatMessage[] = [];
        for (let i = 0; i < children.length; i++) {
          const content = extractTextContent(children[i]);
          if (content && content.length > 5) {
            messages.push({
              index: messages.length,
              role: messages.length % 2 === 0 ? "user" : "assistant",
              content,
              platform: this.name,
            });
          }
        }
        if (messages.length > 0) {
          log(`strategy 4 (positional fallback): ${messages.length} messages`);
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
