import React from "react";
import { Check } from "lucide-react";

export function DoneStep() {
  return (
    <div className="w-full max-w-[480px] px-8 py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
        <Check className="w-6 h-6 text-success" />
      </div>
      <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Context Vault is ready to use.
      </p>

      <div className="text-left bg-card rounded-xl border border-border p-5 mb-6">
        <div className="font-semibold mb-3">Quick tips</div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            Press{" "}
            <kbd className="bg-secondary px-1.5 py-0.5 rounded text-xs text-foreground">
              Ctrl+Shift+Space
            </kbd>{" "}
            (or{" "}
            <kbd className="bg-secondary px-1.5 py-0.5 rounded text-xs text-foreground">
              ⌘+Shift+Space
            </kbd>
            ) to open the popup
          </li>
          <li>Right-click selected text to save it to your vault</li>
          <li>Search results can be injected directly into any AI chat</li>
        </ul>
      </div>

      <button
        onClick={() => window.close()}
        className="px-8 py-3 text-[15px] font-medium bg-foreground text-background rounded-xl hover:bg-foreground/90 transition-colors cursor-pointer"
      >
        Close
      </button>
    </div>
  );
}
