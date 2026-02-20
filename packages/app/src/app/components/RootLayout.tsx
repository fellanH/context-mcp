import { Outlet, Link, Navigate, useLocation, useNavigate } from "react-router";
import {
  Moon,
  Sun,
  Home,
  Search,
  FileText,
  Users,
  Calendar,
  Key,
  CreditCard,
  Database,
  User,
  LogOut,
  ChevronDown,
  Loader2,
  ExternalLink,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "./ui/button";
import { UsageMeter } from "./UsageMeter";
import { TierBadge } from "./TierBadge";
import { useAuth } from "../lib/auth";
import { useUsage, useVaultStatus, useTeams } from "../lib/hooks";
import { useState, useEffect, useRef } from "react";
import { QuickSearch } from "./QuickSearch";

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const mainItems: NavItem[] = [
  { path: "/", label: "Dashboard", icon: Home },
  { path: "/search", label: "Search", icon: Search },
];

const vaultItems: NavItem[] = [
  { path: "/vault/knowledge", label: "Knowledge", icon: FileText },
  { path: "/vault/entities", label: "Entities", icon: Users },
  { path: "/vault/events", label: "Events", icon: Calendar },
];

const settingsItems: NavItem[] = [
  { path: "/settings/api-keys", label: "API Keys", icon: Key },
  { path: "/settings/billing", label: "Billing", icon: CreditCard },
  { path: "/settings/data", label: "Data", icon: Database },
  { path: "/settings/account", label: "Account", icon: User },
  { path: "/settings/sync", label: "Sync", icon: RefreshCw },
];

function getPageTitle(pathname: string): string {
  if (pathname === "/team/new") return "Create Team";
  if (pathname.startsWith("/team/invite")) return "Team Invite";
  if (pathname.startsWith("/team/")) return "Team";
  const all = [...mainItems, ...vaultItems, ...settingsItems];
  const match = all.find((item) =>
    item.path === "/" ? pathname === "/" : pathname.startsWith(item.path),
  );
  return match?.label || "Context Vault";
}

export function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    localServerDown,
    logout,
    vaultMode,
  } = useAuth();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const vaultStatus = useVaultStatus({
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });
  const { data: teams } = useTeams();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Auth loading state — full-page spinner
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Local server not running — show helpful message
  if (localServerDown) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-sm">
          <Database className="size-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-semibold">Local server not running</h2>
          <p className="text-sm text-muted-foreground">
            Start the local vault server to connect:
          </p>
          <code className="block bg-muted rounded-md px-4 py-2 text-sm font-mono">
            context-vault ui
          </code>
          <div className="pt-2">
            <Link to="/login">
              <Button variant="outline" size="sm">
                Use hosted mode instead
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated — redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : user?.email?.[0]?.toUpperCase() || "?";
  const isLocalMode = vaultMode === "local";
  const filteredSettingsItems = isLocalMode
    ? settingsItems.filter((item) =>
        ["Data", "Account", "Sync"].includes(item.label),
      )
    : settingsItems;
  const modeLabel = isLocalMode ? "Local" : "Hosted";
  const connectionState = vaultStatus.isError
    ? "Disconnected"
    : vaultStatus.data?.health === "degraded"
      ? "Degraded"
      : "Connected";
  const connectionBadgeClass =
    connectionState === "Connected"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : connectionState === "Degraded"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border bg-muted text-muted-foreground";

  const isUnlimited = (limit: number) => !isFinite(limit);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        {/* Logo */}
        <div className="px-4 h-14 flex items-center border-b border-border">
          <Link to="/" className="text-base font-semibold tracking-tight">
            Context Vault
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          <NavSection label="Main" items={mainItems} isActive={isActive} />
          <NavSection label="Vault" items={vaultItems} isActive={isActive} />
          {/* Teams */}
          {!isLocalMode && (
            <div className="space-y-0.5">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Teams
              </div>
              {teams?.map((team) => (
                <Link key={team.id} to={`/team/${team.id}`}>
                  <Button
                    variant={
                      isActive(`/team/${team.id}`) ? "secondary" : "ghost"
                    }
                    className="w-full justify-start text-sm"
                    size="sm"
                  >
                    <Users className="size-4 mr-2" />
                    {team.name}
                  </Button>
                </Link>
              ))}
              <Link to="/team/new">
                <Button
                  variant={isActive("/team/new") ? "secondary" : "ghost"}
                  className="w-full justify-start text-sm text-muted-foreground"
                  size="sm"
                >
                  <Plus className="size-4 mr-2" />
                  New Team
                </Button>
              </Link>
            </div>
          )}
          <NavSection
            label="Settings"
            items={filteredSettingsItems}
            isActive={isActive}
          />
        </nav>

        {/* Extension link */}
        <div className="px-3 pb-1">
          <a
            href="https://chromewebstore.google.com/detail/context-vault"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ExternalLink className="size-3.5" />
            Browser Extension
          </a>
        </div>

        {/* Usage meter footer */}
        <div className="p-4 border-t border-border space-y-2">
          {usageLoading ? (
            <div className="space-y-2">
              <div className="h-3 bg-muted rounded animate-pulse" />
              <div className="h-1.5 bg-muted rounded animate-pulse" />
              <div className="flex items-center justify-between mt-1">
                <div className="h-5 w-12 bg-muted rounded animate-pulse" />
                <div className="h-6 w-16 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ) : usage ? (
            <>
              {isUnlimited(usage.entries.limit) ? (
                <div className="text-xs text-muted-foreground">
                  {usage.entries.used} entries
                </div>
              ) : (
                <UsageMeter
                  used={usage.entries.used}
                  limit={usage.entries.limit}
                  label={`${usage.entries.used} / ${usage.entries.limit} entries`}
                />
              )}
              <div className="flex items-center justify-between mt-1">
                {user?.tier && <TierBadge tier={user.tier} />}
                <Link to={isLocalMode ? "/register" : "/settings/billing"}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6 px-2"
                  >
                    {isLocalMode ? "Go Hosted" : "Upgrade"}
                  </Button>
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-border bg-card px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">
              {getPageTitle(location.pathname)}
            </h2>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${connectionBadgeClass}`}
            >
              {modeLabel} • {connectionState}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/search">
              <button
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Search className="size-3" />
                Search...
                <kbd className="ml-2 px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">
                  {"\u2318"}K
                </kbd>
              </button>
            </Link>

            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>

            {/* Avatar dropdown */}
            <div className="relative" ref={avatarRef}>
              <button
                type="button"
                onClick={() => setAvatarOpen(!avatarOpen)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent transition-colors"
              >
                <div className="size-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                  {initials}
                </div>
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>

              {avatarOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-card shadow-lg py-1 z-50">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium truncate">
                      {user?.name || user?.email}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email}
                    </p>
                  </div>
                  <Link
                    to="/settings/account"
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => setAvatarOpen(false)}
                  >
                    <User className="size-3.5" />
                    Account
                  </Link>
                  {!isLocalMode && (
                    <Link
                      to="/settings/api-keys"
                      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onClick={() => setAvatarOpen(false)}
                    >
                      <Key className="size-3.5" />
                      API Keys
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                  >
                    <LogOut className="size-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Cmd+K Quick Search */}
      <QuickSearch />
    </div>
  );
}

function NavSection({
  label,
  items,
  isActive,
}: {
  label: string;
  items: NavItem[];
  isActive: (path: string) => boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.path} to={item.path}>
            <Button
              variant={isActive(item.path) ? "secondary" : "ghost"}
              className="w-full justify-start text-sm"
              size="sm"
            >
              <Icon className="size-4 mr-2" />
              {item.label}
            </Button>
          </Link>
        );
      })}
    </div>
  );
}
