import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../lib/auth";
import { ApiError, isLocalConnection, api } from "../lib/api";
import type { VaultMode } from "../lib/types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { UpgradeToHostedDialog } from "../components/UpgradeToHostedDialog";
import { Key, Loader2, HardDrive, Cloud, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export function Login() {
  const { loginWithApiKey, loginWithLocalVault } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLocal = isLocalConnection();
  const [mode, setMode] = useState<VaultMode>(isLocal ? "hosted" : "hosted");
  const [apiKey, setApiKey] = useState("");
  const [vaultDir, setVaultDir] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  // Upgrade dialog state
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeToken, setUpgradeToken] = useState("");
  const [localEntryCount, setLocalEntryCount] = useState(0);

  // Handle OAuth error params
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "oauth_denied") {
      toast.error("Sign-in was cancelled");
    } else if (error === "oauth_failed") {
      toast.error("Google sign-in failed. Please try again.");
    } else if (error === "oauth_invalid_state") {
      toast.error("Sign-in session expired. Please try again.");
    } else if (error === "registration_failed") {
      toast.error("Account creation failed. Please try again.");
    }
  }, [searchParams]);

  // Fetch local entry count when in local-via-hosted mode
  useEffect(() => {
    if (!isLocal) return;
    api
      .get<{ entries: unknown[]; total: number }>("/vault/entries?limit=1")
      .then((data) => setLocalEntryCount(data.total))
      .catch(() => {});
  }, [isLocal]);

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await loginWithApiKey(apiKey.trim());
      if (isLocal) {
        // Show upgrade dialog instead of navigating
        setUpgradeToken(apiKey.trim());
        setShowUpgrade(true);
      } else {
        toast.success("Authenticated successfully");
        navigate("/");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          toast.error("Invalid API key");
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("Failed to authenticate");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (localSubmitting) return;
    setLocalSubmitting(true);
    try {
      await loginWithLocalVault(vaultDir.trim());
      toast.success("Connected to local vault");
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          toast.error(
            "Local vault requires context-vault ui. Run: context-vault ui",
          );
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("Failed to connect to local vault");
      }
    } finally {
      setLocalSubmitting(false);
    }
  };

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const res = await fetch(`${API_URL}/local/browse`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.path) setVaultDir(data.path);
      }
    } catch {
      // Browse not available (non-local or unsupported platform)
    } finally {
      setBrowsing(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Context Vault</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your account
          </p>
        </div>

        {/* Local-via-hosted banner */}
        {isLocal && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-center">
            <p className="font-medium">Connected to local vault</p>
            <p className="text-xs text-muted-foreground mt-1">
              Sign in to upgrade to hosted mode
            </p>
          </div>
        )}

        {/* Mode selector — hidden when connected via local param */}
        {!isLocal && (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("local")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                mode === "local"
                  ? "border-primary ring-1 ring-primary/20"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <HardDrive className="size-5 mb-2" />
              <p className="text-sm font-medium">Local Vault</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run on your own machine. No account needed.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("hosted")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                mode === "hosted"
                  ? "border-primary ring-1 ring-primary/20"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <Cloud className="size-5 mb-2" />
              <p className="text-sm font-medium">Hosted Vault</p>
              <p className="text-xs text-muted-foreground mt-1">
                Use Context Vault's cloud service.
              </p>
            </button>
          </div>
        )}

        {/* Conditional form */}
        {mode === "local" && !isLocal ? (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleLocalSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="vaultDir">Vault folder path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="vaultDir"
                      type="text"
                      placeholder="e.g. ~/vault or /Users/me/vault"
                      value={vaultDir}
                      onChange={(e) => setVaultDir(e.target.value)}
                      disabled={localSubmitting}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleBrowse}
                      disabled={browsing || localSubmitting}
                      className="shrink-0"
                    >
                      {browsing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Browse"
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use the default vault (~/vault)
                  </p>
                </div>
                <Button
                  type="submit"
                  variant="default"
                  className="w-full"
                  disabled={localSubmitting}
                >
                  {localSubmitting ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    "Connect to local vault"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <Button
                variant="default"
                className="w-full gap-2"
                onClick={handleGoogleLogin}
              >
                <svg className="size-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Sign in with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or use API key
                  </span>
                </div>
              </div>

              <form onSubmit={handleApiKeySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="apiKey"
                      type="password"
                      placeholder="cv_..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="pl-9"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign in with API key"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link
            to="/register"
            className="text-foreground hover:underline font-medium"
          >
            Register
          </Link>
        </p>
      </div>

      {/* Upgrade to hosted dialog */}
      <UpgradeToHostedDialog
        open={showUpgrade}
        onOpenChange={setShowUpgrade}
        hostedToken={upgradeToken}
        entryCount={localEntryCount}
      />
    </div>
  );
}
