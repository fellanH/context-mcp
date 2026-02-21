import React from "react";
import { ArrowUpRight } from "lucide-react";
import type { SearchResult } from "@/shared/types";

interface Props {
  results: SearchResult[];
  query: string;
  onInject: (text: string) => void;
}

export function ResultList({ results, query, onInject }: Props) {
  if (!query) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        Search your vault to find relevant context.
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        No results for "{query}"
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <div className="text-xs text-muted-foreground mb-2">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </div>
      <div className="space-y-2">
        {results.map((result) => (
          <ResultCard key={result.id} result={result} onInject={onInject} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  onInject,
}: {
  result: SearchResult;
  onInject: (text: string) => void;
}) {
  const preview = result.body?.slice(0, 150) || "";
  const title = result.title || result.kind;

  return (
    <div className="p-3 bg-card rounded-xl border border-border">
      <div className="flex justify-between items-start mb-1">
        <div className="text-sm font-medium text-foreground flex-1 leading-snug">
          {title}
        </div>
        <span className="text-[11px] px-1.5 py-0.5 bg-secondary rounded text-muted-foreground ml-2 whitespace-nowrap">
          {result.kind}
        </span>
      </div>

      <div className="text-xs text-muted-foreground mb-1">
        {result.score.toFixed(3)} · {result.tags.join(", ") || "no tags"}
      </div>

      <div className="text-sm text-muted-foreground leading-snug mb-2">
        {preview}
        {preview.length >= 150 ? "..." : ""}
      </div>

      <button
        onClick={() => onInject(result.body || "")}
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors cursor-pointer"
      >
        Inject into chat
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );
}
