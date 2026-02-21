import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command";
import { Badge } from "./ui/badge";
import {
  Search,
  Home,
  FileText,
  Users,
  Calendar,
  Key,
  CreditCard,
  Database,
  User,
  Loader2,
} from "lucide-react";
import { api } from "../lib/api";
import { transformSearchResult } from "../lib/types";
import type { Entry, ApiSearchResult } from "../lib/types";

const navShortcuts = [
  { label: "Dashboard", path: "/", icon: Home },
  { label: "Search", path: "/search", icon: Search },
  { label: "Knowledge", path: "/vault/knowledge", icon: FileText },
  { label: "Entities", path: "/vault/entities", icon: Users },
  { label: "Events", path: "/vault/events", icon: Calendar },
  { label: "API Keys", path: "/settings/api-keys", icon: Key },
  { label: "Billing", path: "/settings/billing", icon: CreditCard },
  { label: "Data", path: "/settings/data", icon: Database },
  { label: "Account", path: "/settings/account", icon: User },
];

export function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Debounced API search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const raw = await api.post<{ results: ApiSearchResult[] }>(
          "/vault/search",
          {
            query: query.trim(),
            limit: 5,
          },
        );
        setSearchResults(raw.results.map(transformSearchResult));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery("");
      navigate(path);
    },
    [navigate],
  );

  const handleViewAll = useCallback(() => {
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(query)}`);
    setQuery("");
  }, [navigate, query]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search vault or navigate..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {isSearching ? (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="size-4 animate-spin" />
              <span>Searching...</span>
            </div>
          ) : (
            "No results found."
          )}
        </CommandEmpty>

        {searchResults.length > 0 && (
          <CommandGroup heading="Results">
            {searchResults.map((entry) => (
              <CommandItem
                key={entry.id}
                onSelect={() => {
                  const path =
                    entry.category === "knowledge"
                      ? "/vault/knowledge"
                      : entry.category === "entity"
                        ? "/vault/entities"
                        : "/vault/events";
                  handleSelect(path);
                }}
              >
                <FileText className="size-4 mr-2 shrink-0" />
                <span className="flex-1 truncate">{entry.title}</span>
                <Badge
                  variant="secondary"
                  className="text-[10px] ml-2 shrink-0"
                >
                  {entry.kind}
                </Badge>
              </CommandItem>
            ))}
            {query.trim() && (
              <CommandItem onSelect={handleViewAll}>
                <Search className="size-4 mr-2 shrink-0" />
                <span className="text-muted-foreground">
                  View all results for "{query}"
                </span>
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {searchResults.length > 0 && <CommandSeparator />}

        <CommandGroup heading="Navigate">
          {navShortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.path}
                onSelect={() => handleSelect(item.path)}
              >
                <Icon className="size-4 mr-2 shrink-0" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
