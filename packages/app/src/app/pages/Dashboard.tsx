import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { UsageMeter } from "../components/UsageMeter";
import { useEntries, useUsage, useApiKeys } from "../lib/hooks";
import { useAuth } from "../lib/auth";
import {
  getOnboardingSteps,
  isOnboardingDismissed,
  dismissOnboarding,
  resetOnboarding,
} from "../lib/onboarding";
import { formatMegabytes } from "../lib/format";
import { uploadLocalVault } from "../lib/api";
import {
  FileText,
  HardDrive,
  Zap,
  Key,
  Search,
  Plus,
  Upload,
  X,
  Copy,
  Check,
  ExternalLink,
  Cloud,
  Loader2,
  CircleCheck,
  Link2,
  UserPlus,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "/api";

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

const STEP_ICONS: Record<string, React.ElementType> = {
  "sign-in": UserPlus,
  "connect-folder": FolderOpen,
  "connect-tools": Link2,
  "first-entry": Plus,
  "go-hosted": Cloud,
  "install-extension": ExternalLink,
};

export function Dashboard() {
  const { user, isAuthenticated, vaultMode } = useAuth();
  const navigate = useNavigate();
  const { data: entriesData, isLoading: entriesLoading } = useEntries({ limit: 10 });
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: apiKeys } = useApiKeys();

  const entriesUsed = usage?.entries.used ?? 0;
  const isLocalMode = vaultMode === "local";
  const hasApiKey = (apiKeys?.length ?? 0) > 0;
  const hasMcpActivity = (apiKeys ?? []).some((key) => Boolean(key.lastUsedAt));
  const steps = getOnboardingSteps({
    isAuthenticated,
    vaultMode,
    entriesUsed,
    hasApiKey,
    hasMcpActivity,
  });
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingDismissed());
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [uploadDismissed, setUploadDismissed] = useState(
    () => localStorage.getItem("context-vault-upload-dismissed") === "true"
  );
  const [uploading, setUploading] = useState(false);

  const allComplete = steps.filter((s) => s.id !== "go-hosted").every((s) => s.completed);
  const completedCount = steps.filter((s) => s.completed).length;
  const totalRequired = steps.filter((s) => s.id !== "go-hosted").length;

  const handleDismiss = () => {
    dismissOnboarding();
    setShowOnboarding(false);
  };

  const connectCommand = isLocalMode
    ? "npx context-vault connect"
    : "npx context-vault connect --key YOUR_API_KEY";

  const copyConnectCommand = async () => {
    await navigator.clipboard.writeText(connectCommand);
    setCopiedCmd(true);
    toast.success("Connect command copied");
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleStepAction = (step: (typeof steps)[0]) => {
    if (step.action === "copy-connect-command") {
      copyConnectCommand();
    } else if (step.action === "chrome-web-store-link") {
      window.open("https://chromewebstore.google.com/detail/context-vault", "_blank");
    } else if (step.action?.startsWith("/")) {
      navigate(step.action);
    }
  };

  const isUnlimited = (limit: number) => !Number.isFinite(limit);

  const usageCards = usage
    ? [
        {
          label: "Entries",
          icon: FileText,
          used: usage.entries.used,
          limit: usage.entries.limit,
          display: `${usage.entries.used}`,
          sub: isUnlimited(usage.entries.limit) ? null : `of ${usage.entries.limit}`,
        },
        {
          label: "Storage",
          icon: HardDrive,
          used: usage.storage.usedMb,
          limit: usage.storage.limitMb,
          display: `${formatMegabytes(usage.storage.usedMb)} MB`,
          sub: isUnlimited(usage.storage.limitMb) ? null : `of ${formatMegabytes(usage.storage.limitMb)} MB`,
        },
        {
          label: "Requests Today",
          icon: Zap,
          used: usage.requestsToday.used,
          limit: usage.requestsToday.limit,
          display: `${usage.requestsToday.used}`,
          sub: isUnlimited(usage.requestsToday.limit) ? null : `of ${usage.requestsToday.limit}`,
        },
        {
          label: "API Keys",
          icon: Key,
          used: apiKeys?.length ?? 0,
          limit: Infinity,
          display: `${apiKeys?.length ?? 0} active`,
          sub: null,
        },
      ]
    : [];

  const entries = entriesData?.entries ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {allComplete
            ? "Welcome back. Here's your vault at a glance."
            : "Get started by completing the steps below."}
        </p>
      </div>

      {/* Onboarding Journey — Hero section */}
      {showOnboarding && !allComplete && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Getting Started</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {completedCount} of {totalRequired} steps complete
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleDismiss}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {steps.map((step) => {
                const Icon = STEP_ICONS[step.id] || FileText;
                const isOptional = step.id === "go-hosted";

                return (
                  <div
                    key={step.id}
                    className={`relative rounded-lg border p-4 space-y-3 transition-colors ${
                      step.completed
                        ? "border-primary/20 bg-primary/5"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className={`rounded-full p-2 ${
                        step.completed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}>
                        {step.completed ? (
                          <CircleCheck className="size-4" />
                        ) : (
                          <Icon className="size-4" />
                        )}
                      </div>
                      {isOptional && (
                        <Badge variant="outline" className="text-[10px]">Optional</Badge>
                      )}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${step.completed ? "text-muted-foreground line-through" : ""}`}>
                        {step.label}
                      </p>
                      {step.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      )}
                    </div>
                    {!step.completed && step.action && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full gap-1.5 text-xs"
                        onClick={() => handleStepAction(step)}
                      >
                        {step.action === "copy-connect-command" && (
                          copiedCmd ? <Check className="size-3" /> : <Copy className="size-3" />
                        )}
                        {step.actionLabel || "Go"}
                      </Button>
                    )}
                    {!step.completed && step.id === "connect-tools" && (
                      <pre className="bg-muted p-2 rounded text-[10px] font-mono overflow-x-auto">
                        {connectCommand}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup complete badge */}
      {allComplete && !showOnboarding && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-primary/20 bg-primary/5">
          <div className="flex items-center gap-2">
            <CircleCheck className="size-4 text-primary" />
            <span className="text-sm text-primary font-medium">Setup complete</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              resetOnboarding();
              setShowOnboarding(true);
            }}
          >
            Show setup
          </Button>
        </div>
      )}

      {/* Upload prompt — local user who now has a hosted account */}
      {isLocalMode && !uploadDismissed && entriesUsed > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Cloud className="size-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Upload your local vault to the cloud?</p>
                <p className="text-xs text-muted-foreground">
                  Sync {entriesUsed} {entriesUsed === 1 ? "entry" : "entries"} to your hosted vault for backup and cross-device access.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <Button
                variant="default"
                size="sm"
                disabled={uploading}
                onClick={async () => {
                  const key = window.prompt("Enter your hosted API key (cv_...):");
                  if (!key?.startsWith("cv_")) return;
                  setUploading(true);
                  try {
                    const result = await uploadLocalVault(key);
                    toast.success(`Uploaded ${result.imported} entries`);
                    if (result.failed > 0) {
                      toast.warning(`${result.failed} entries failed to upload`);
                    }
                    setUploadDismissed(true);
                    localStorage.setItem("context-vault-upload-dismissed", "true");
                  } catch {
                    toast.error("Upload failed. Check your API key and try again.");
                  } finally {
                    setUploading(false);
                  }
                }}
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="size-3.5 mr-1.5" />
                    Upload
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setUploadDismissed(true);
                  localStorage.setItem("context-vault-upload-dismissed", "true");
                }}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage Overview */}
      {usageLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-8 w-20 bg-muted rounded animate-pulse" />
                <div className="h-1.5 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {usageCards.map((card) => {
            const Icon = card.icon;
            const unlimited = isUnlimited(card.limit);
            const pct = !unlimited && card.limit > 0 ? (card.used / card.limit) * 100 : 0;
            const isWarning = !unlimited && pct >= 80;
            const isCritical = !unlimited && pct >= 100;

            return (
              <Card key={card.label}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-medium text-muted-foreground">
                      {card.label}
                    </CardTitle>
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-semibold ${isCritical ? "text-red-500" : isWarning ? "text-amber-500" : ""}`}>
                      {card.display}
                    </span>
                    {card.sub && (
                      <span className="text-xs text-muted-foreground">{card.sub}</span>
                    )}
                  </div>
                  {!unlimited && <UsageMeter used={card.used} limit={card.limit} />}
                  {isCritical && (
                    <Link to="/settings/billing" className="text-xs text-red-500 hover:underline">
                      Upgrade to increase limit
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                    <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-12 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No entries yet. Save your first entry to see activity here.
            </p>
          ) : (
            <div className="space-y-2">
              {entries
                .slice()
                .sort((a, b) => b.created.getTime() - a.created.getTime())
                .slice(0, 10)
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-medium truncate">{entry.title}</span>
                      <Badge
                        variant={
                          entry.category === "knowledge"
                            ? "default"
                            : entry.category === "entity"
                            ? "outline"
                            : "secondary"
                        }
                        className="text-[10px] shrink-0"
                      >
                        {entry.category}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {entry.kind}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                      {formatRelativeTime(entry.created)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link to="/search">
            <Search className="size-4 mr-1.5" />
            Search vault
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/vault/knowledge">
            <Plus className="size-4 mr-1.5" />
            New Entry
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/settings/data">
            <Upload className="size-4 mr-1.5" />
            Import data
          </Link>
        </Button>
      </div>
    </div>
  );
}
