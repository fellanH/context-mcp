import React from "react";
import { Search, BookmarkPlus, Plug } from "lucide-react";

interface Props {
  onNext: () => void;
}

const features = [
  {
    icon: Search,
    title: "Search",
    desc: "Find relevant context from your vault and inject it directly into AI chats",
  },
  {
    icon: BookmarkPlus,
    title: "Save",
    desc: "Right-click any text on a webpage to save it as an insight, note, or reference",
  },
  {
    icon: Plug,
    title: "Connect",
    desc: "Works with ChatGPT, Claude, and Gemini — plus any text input",
  },
];

export function WelcomeStep({ onNext }: Props) {
  return (
    <div className="w-full max-w-[480px] px-8 py-12">
      <h1 className="text-4xl font-bold mb-2">Context Vault</h1>
      <p className="text-muted-foreground mb-8">
        Your knowledge, always within reach.
      </p>

      <ul className="space-y-4 mb-8">
        {features.map(({ icon: Icon, title, desc }) => (
          <li key={title} className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-card flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-foreground" />
            </div>
            <div>
              <div className="font-semibold mb-0.5">{title}</div>
              <div className="text-sm text-muted-foreground leading-snug">
                {desc}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={onNext}
        className="w-full py-3 text-[15px] font-medium bg-foreground text-background rounded-xl hover:bg-foreground/90 transition-colors cursor-pointer"
      >
        Get Started
      </button>
    </div>
  );
}
