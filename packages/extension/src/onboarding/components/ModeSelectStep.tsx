import React from "react";
import { HardDrive, Cloud } from "lucide-react";
import type { VaultMode } from "@/shared/types";
import { cn } from "@/shared/cn";

interface Props {
  mode: VaultMode;
  onSelect: (mode: VaultMode) => void;
  onNext: () => void;
}

const modes = [
  {
    value: "local" as const,
    icon: HardDrive,
    title: "Local Vault",
    desc: "Run on your own machine. No account needed.",
    sub: "Requires context-vault installed via npm",
  },
  {
    value: "hosted" as const,
    icon: Cloud,
    title: "Hosted Vault",
    desc: "Use Context Vault's cloud service.",
    sub: "Requires an account at context-vault.com",
  },
];

export function ModeSelectStep({ mode, onSelect, onNext }: Props) {
  return (
    <div className="w-full max-w-[480px] px-8 py-12">
      <h2 className="text-2xl font-bold mb-2">Choose Your Vault</h2>
      <p className="text-sm text-muted-foreground mb-6">
        How do you want to run Context Vault?
      </p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {modes.map(({ value, icon: Icon, title, desc, sub }) => (
          <button
            key={value}
            onClick={() => onSelect(value)}
            className={cn(
              "flex flex-col items-start p-4 rounded-xl border bg-card text-left transition-all cursor-pointer",
              mode === value
                ? "border-foreground/40 ring-1 ring-foreground/20"
                : "border-border hover:border-foreground/20",
            )}
          >
            <Icon className="w-6 h-6 mb-3 text-foreground" />
            <div className="font-semibold mb-1">{title}</div>
            <div className="text-sm text-muted-foreground leading-snug mb-2">
              {desc}
            </div>
            <div className="text-xs text-muted-foreground/70">{sub}</div>
          </button>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full py-3 text-[15px] font-medium bg-foreground text-background rounded-xl hover:bg-foreground/90 transition-colors cursor-pointer"
      >
        Continue
      </button>
    </div>
  );
}
