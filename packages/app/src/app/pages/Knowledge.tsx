import { useState } from "react";
import type { Entry } from "../lib/types";
import { useEntries } from "../lib/hooks";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import {
  Search,
  Plus,
  Filter,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { EntryInspector } from "../components/EntryInspector";
import { NewEntryDialog } from "../components/NewEntryDialog";
import { EmptyState } from "../components/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

const PAGE_SIZE = 10;

export function Knowledge() {
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useEntries({
    category: "knowledge",
    kind: kindFilter === "all" ? undefined : kindFilter,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side text filter on loaded page
  const filteredEntries = searchQuery
    ? entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          entry.body.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : entries;

  // Reset page when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const handleKindChange = (value: string) => {
    setKindFilter(value);
    setPage(0);
  };

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold">Knowledge</h1>
              <p className="text-sm text-muted-foreground">
                Insights, Decisions, and Patterns
              </p>
            </div>
            <Button onClick={() => setShowNewEntry(true)}>
              <Plus className="size-4 mr-2" />
              New Entry
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search knowledge..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={kindFilter} onValueChange={handleKindChange}>
              <SelectTrigger className="w-40">
                <Filter className="size-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kinds</SelectItem>
                <SelectItem value="insight">Insight</SelectItem>
                <SelectItem value="decision">Decision</SelectItem>
                <SelectItem value="pattern">Pattern</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">Failed to load entries</p>
              <p className="text-xs mt-1">
                Check your connection and try again
              </p>
            </div>
          ) : total === 0 && !searchQuery && kindFilter === "all" ? (
            <EmptyState
              icon={FileText}
              title="No knowledge entries yet"
              description="Knowledge entries capture insights, decisions, and patterns. Save your first entry via Claude Code or import existing data."
              actions={[
                { label: "Create entry", onClick: () => setShowNewEntry(true) },
              ]}
            />
          ) : (
            <div className="p-6">
              <div className="border border-border rounded-lg overflow-hidden bg-card">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        ID
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Title
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Kind
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                        Tags
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedEntry(entry)}
                      >
                        <td className="px-4 py-3">
                          <code className="text-xs font-mono text-muted-foreground">
                            {entry.id.slice(0, 12)}...
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium">
                            {entry.title}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="default" className="text-xs">
                            {entry.kind}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {entry.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                            {entry.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{entry.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(entry.updated)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredEntries.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground">
                    <p className="text-sm">No entries match your search</p>
                    <p className="text-xs mt-1">
                      Try adjusting your search or filters
                    </p>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    Showing {page * PAGE_SIZE + 1}–
                    {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <EntryInspector
        entry={selectedEntry}
        open={selectedEntry !== null}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />

      <NewEntryDialog
        open={showNewEntry}
        onOpenChange={setShowNewEntry}
        category="knowledge"
      />
    </>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
