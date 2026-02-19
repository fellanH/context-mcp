import { injectContentEditable } from "./types";
import type { PlatformAdapter } from "./types";

export const geminiAdapter: PlatformAdapter = {
  name: "Gemini",

  matches() {
    return location.hostname === "gemini.google.com";
  },

  getChatInput() {
    // Fallback selector chain for Gemini's Quill-based editor
    return (
      document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  },

  injectText(text: string) {
    const input = this.getChatInput();
    if (!input) return false;
    return injectContentEditable(input, text);
  },
};
