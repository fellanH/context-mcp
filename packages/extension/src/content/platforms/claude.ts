import { injectContentEditable } from "./types";
import type { PlatformAdapter } from "./types";

export const claudeAdapter: PlatformAdapter = {
  name: "Claude",

  matches() {
    return location.hostname === "claude.ai";
  },

  getChatInput() {
    // Fallback selector chain for Claude's ProseMirror editor
    return (
      document.querySelector<HTMLElement>('[contenteditable="true"].ProseMirror') ||
      document.querySelector<HTMLElement>("div.ProseMirror[contenteditable]") ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  },

  injectText(text: string) {
    const input = this.getChatInput();
    if (!input) return false;
    return injectContentEditable(input, text);
  },
};
