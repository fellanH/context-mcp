import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Search as SearchIcon, ChevronDown, ChevronUp } from "lucide-react";
import { EntryInspector } from "../components/EntryInspector";
import { useSearch } from "../lib/hooks";
import type { SearchResult } from "../lib/types";

const exampleQueries = [
  "error handling patterns",
  "project status",
  "recent decisions",
  "database architecture",
  "team contacts",
];

export function Search() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [hybridMode, setHybridMode] = useState(true);
  const [resultLimit, setResultLimit] = useState(10);
  const [selectedEntry, setSelectedEntry] = useState<SearchResult | null>(null);

  const searchMutation = useSearch();

  const handleSearch = (q?: string) => {
    const searchQuery = (q || query).trim();
    if (!searchQuery) return;

    setSearched(true);
    if (q) setQuery(q);

    searchMutation.mutate({
      query: searchQuery,
      category: categoryFilter !== "all" ? categoryFilter : undefined,
      limit: resultLimit,
    });
  };

  const results = searchMutation.data?.results ?? [];
  const openResult = (result: SearchResult) => setSelectedEntry(result);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search across your entire vault using semantic or hybrid matching.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search your vault..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="knowledge">Knowledge</SelectItem>
              <SelectItem value="entity">Entities</SelectItem>
              <SelectItem value="event">Events</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => handleSearch()}
            disabled={!query.trim() || searchMutation.isPending}
          >
            Search
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Advanced
          {showAdvanced ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>

        {showAdvanced && (
          <div className="flex items-center gap-6 p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2">
              <Label htmlFor="hybrid" className="text-xs">
                Hybrid mode
              </Label>
              <Switch
                id="hybrid"
                checked={hybridMode}
                onCheckedChange={setHybridMode}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="limit" className="text-xs">
                Results
              </Label>
              <Select
                value={String(resultLimit)}
                onValueChange={(v) => setResultLimit(Number(v))}
              >
                <SelectTrigger className="w-20 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {searchMutation.isPending && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!searchMutation.isPending && searched && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No results found for "{query}"
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Try a different query or broaden your search
          </p>
        </div>
      )}

      {!searchMutation.isPending && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {results.length} results
          </p>
          {results.map((result) => (
            <Card
              key={result.id}
              className="hover:bg-accent/50 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => openResult(result)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openResult(result);
                }
              }}
              aria-label={`Open ${result.title}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm truncate">
                        {result.title}
                      </h3>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {result.kind}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {result.body.replace(/[#*`]/g, "").slice(0, 200)}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      {result.tags.slice(0, 3).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono text-muted-foreground">
                      {(result.score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!searched && (
        <div className="text-center py-12 space-y-4">
          <p className="text-muted-foreground text-sm">
            Try searching for something
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {exampleQueries.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleSearch(q)}
                className="px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <EntryInspector
        entry={selectedEntry}
        open={selectedEntry !== null}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />
    </div>
  );
}
