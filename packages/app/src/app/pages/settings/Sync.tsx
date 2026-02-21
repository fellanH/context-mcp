import { useState, useEffect } from "react";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import {
  Loader2,
  Link2,
  Unlink,
  RefreshCw,
  Cloud,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface LinkStatus {
  linked: boolean;
  email?: string;
  hostedUrl?: string;
  linkedAt?: string;
  tier?: string;
}

interface SyncResult {
  pushed: number;
  pulled: number;
  failed: number;
  errors: string[];
}

function useApi() {
  const base = window.location.origin;
  return {
    async getLinkStatus(): Promise<LinkStatus> {
      const res = await fetch(`${base}/api/local/link`);
      return res.json();
    },
    async link(
      apiKey: string,
      hostedUrl?: string,
    ): Promise<LinkStatus & { error?: string }> {
      const res = await fetch(`${base}/api/local/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, hostedUrl }),
      });
      return res.json();
    },
    async sync(): Promise<SyncResult & { error?: string }> {
      const res = await fetch(`${base}/api/local/sync`, { method: "POST" });
      return res.json();
    },
  };
}

export function Sync() {
  const api = useApi();
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [hostedUrl, setHostedUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  useEffect(() => {
    api
      .getLinkStatus()
      .then(setStatus)
      .catch(() => setStatus({ linked: false }))
      .finally(() => setLoading(false));
  }, []);

  const handleLink = async () => {
    if (!apiKey.trim()) return;
    setLinking(true);
    try {
      const result = await api.link(
        apiKey.trim(),
        hostedUrl.trim() || undefined,
      );
      if (result.error) {
        toast.error(result.error);
      } else {
        setStatus({
          linked: true,
          email: result.email,
          tier: result.tier,
          hostedUrl: hostedUrl.trim() || undefined,
          linkedAt: new Date().toISOString(),
        });
        setApiKey("");
        toast.success(`Linked to ${result.email}`);
      }
    } catch {
      toast.error("Failed to link account");
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    try {
      await api.link("", "");
      setStatus({ linked: false });
      toast.success("Account unlinked");
    } catch {
      toast.error("Failed to unlink");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.sync();
      if (result.error) {
        toast.error(result.error);
      } else {
        setLastSync(result);
        toast.success(
          `Synced: ${result.pushed} pushed, ${result.pulled} pulled`,
        );
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center justify-center min-h-[200px]">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sync</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Link your local vault to a hosted account for cloud sync.
        </p>
      </div>

      {/* Link Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="size-4" />
            <CardTitle className="text-base">Account Link</CardTitle>
            {status?.linked ? (
              <Badge variant="default" className="ml-auto">
                Linked
              </Badge>
            ) : (
              <Badge variant="secondary" className="ml-auto">
                Not linked
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.linked ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Email</span>
                <span>{status.email}</span>
                <span className="text-muted-foreground">Tier</span>
                <span className="capitalize">{status.tier || "free"}</span>
                {status.hostedUrl && (
                  <>
                    <span className="text-muted-foreground">Server</span>
                    <span className="text-xs font-mono">
                      {status.hostedUrl}
                    </span>
                  </>
                )}
                {status.linkedAt && (
                  <>
                    <span className="text-muted-foreground">Linked</span>
                    <span>
                      {new Date(status.linkedAt).toLocaleDateString()}
                    </span>
                  </>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={handleUnlink}>
                <Unlink className="size-3.5 mr-1.5" />
                Unlink
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="cv_..."
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hostedUrl">
                  Server URL{" "}
                  <span className="text-muted-foreground text-xs">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="hostedUrl"
                  value={hostedUrl}
                  onChange={(e) => setHostedUrl(e.target.value)}
                  placeholder="https://api.context-vault.com"
                />
              </div>
              <Button
                size="sm"
                onClick={handleLink}
                disabled={linking || !apiKey.trim()}
              >
                {linking ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <Link2 className="size-3.5 mr-1.5" />
                )}
                Link Account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync */}
      {status?.linked && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="size-4" />
              <CardTitle className="text-base">Sync</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sync entries between your local vault and hosted account.
              Local-only entries are pushed up, remote-only entries are pulled
              down.
            </p>

            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Sync Now
                </>
              )}
            </Button>

            {lastSync && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {lastSync.failed === 0 ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : (
                    <AlertCircle className="size-4 text-yellow-500" />
                  )}
                  Sync Results
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm text-center">
                  <div>
                    <div className="text-lg font-bold">{lastSync.pushed}</div>
                    <div className="text-xs text-muted-foreground">Pushed</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{lastSync.pulled}</div>
                    <div className="text-xs text-muted-foreground">Pulled</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">{lastSync.failed}</div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                  </div>
                </div>
                {lastSync.errors.length > 0 && (
                  <div className="text-xs text-destructive space-y-0.5">
                    {lastSync.errors.slice(0, 5).map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
