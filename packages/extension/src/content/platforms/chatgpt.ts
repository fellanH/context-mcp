import { injectContentEditable } from "./types";
import type { PlatformAdapter } from "./types";

export const chatgptAdapter: PlatformAdapter = {
  name: "ChatGPT",

  matches() {
    return location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com";
  },

  getChatInput() {
    // Fallback selector chain for ChatGPT's prompt textarea
    return (
      document.querySelector<HTMLElement>("#prompt-textarea") ||
      document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]') ||
      document.querySelector<HTMLElement>('div[contenteditable][role="textbox"]') ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  },

  injectText(text: string) {
    const input = this.getChatInput();
    if (!input) return false;
    return injectContentEditable(input, text);
  },
};
