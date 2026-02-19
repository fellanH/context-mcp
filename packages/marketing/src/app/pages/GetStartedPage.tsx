import { useState } from "react";
import { HardDrive, Cloud, Copy, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { appHref, docsQuickstartUrl } from "../lib/links";

type Mode = "local" | "hosted";

const localSteps = [
  { label: "Install", command: "npm install -g context-vault" },
  { label: "Setup", command: "context-vault setup" },
  { label: "Open dashboard (optional)", command: "context-vault ui" },
];

export function GetStartedPage() {
  const [mode, setMode] = useState<Mode>("local");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyCommand = async (command: string, idx: number) => {
    await navigator.clipboard.writeText(command);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <main>
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <div className="text-center space-y-3 mb-10">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Get Started with Context Vault
          </h1>
          <p className="text-muted-foreground">Choose how you want to run it.</p>
        </div>

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            type="button"
            onClick={() => setMode("local")}
            className={`rounded-lg border p-6 text-left transition-colors ${
              mode === "local"
                ? "border-primary ring-1 ring-primary/20"
                : "border-border hover:border-primary/30"
            }`}
          >
            <HardDrive className="size-6 mb-3" />
            <p className="text-base font-medium">Local-First</p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>No account needed</li>
              <li>Data stays on your machine</li>
              <li>npm install</li>
            </ul>
          </button>
          <button
            type="button"
            onClick={() => setMode("hosted")}
            className={`rounded-lg border p-6 text-left transition-colors ${
              mode === "hosted"
                ? "border-primary ring-1 ring-primary/20"
                : "border-border hover:border-primary/30"
            }`}
          >
            <Cloud className="size-6 mb-3" />
            <p className="text-base font-medium">Hosted</p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>Cross-device sync</li>
              <li>Dashboard included</li>
              <li>Team-ready</li>
            </ul>
          </button>
        </div>

        {/* Conditional content */}
        {mode === "local" ? (
          <Card>
            <CardContent className="p-6 space-y-5">
              {localSteps.map((step, idx) => (
                <div key={step.label} className="space-y-2">
                  <p className="text-sm font-medium">
                    {idx + 1}. {step.label}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono">
                      {step.command}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyCommand(step.command, idx)}
                    >
                      {copiedIdx === idx ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
              <Button asChild variant="outline" className="w-full">
                <a href={docsQuickstartUrl} target="_blank" rel="noreferrer">
                  View full documentation <ArrowRight className="size-4 ml-1" />
                </a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Create your free account to get started with hosted mode.
              </p>
              <Button asChild size="lg">
                <a href={appHref("/register")}>
                  Start free <ArrowRight className="size-4 ml-1" />
                </a>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
