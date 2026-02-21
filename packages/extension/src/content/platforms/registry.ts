/**
 * Platform adapter registry — detects which AI chat platform we're on
 * and returns the appropriate adapter.
 */

import type { PlatformAdapter } from "./types";
import { chatgptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { geminiAdapter } from "./gemini";
import { genericAdapter } from "./generic";

const adapters: PlatformAdapter[] = [
  chatgptAdapter,
  claudeAdapter,
  geminiAdapter,
  genericAdapter,
];

export function detectPlatform(): PlatformAdapter {
  for (const adapter of adapters) {
    if (adapter.matches()) return adapter;
  }
  return genericAdapter; // Fallback
}
