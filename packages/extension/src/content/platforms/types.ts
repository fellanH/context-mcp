/** Interface that each platform adapter must implement */
export interface PlatformAdapter {
  /** Human-readable platform name */
  name: string;
  /** Returns true if the current page matches this platform */
  matches(): boolean;
  /** Get the chat input element */
  getChatInput(): HTMLElement | null;
  /** Inject text into the chat input */
  injectText(text: string): boolean;
}

function readText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.textContent || "";
}

/**
 * Reliable contenteditable injection with snapshot-and-verify pattern.
 * Each step checks whether the DOM actually changed before moving on.
 */
export function injectContentEditable(el: HTMLElement, text: string): boolean {
  el.focus();

  // Step 1: execCommand
  const before1 = readText(el);
  document.execCommand("insertText", false, text);
  if (readText(el) !== before1) return true;

  // Step 2: Synthetic paste (don't check dispatchEvent return — it's inverted)
  const before2 = readText(el);
  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch {}
  if (readText(el) !== before2) return true;

  // Step 3: Direct manipulation (last resort)
  el.textContent = (el.textContent || "") + text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
