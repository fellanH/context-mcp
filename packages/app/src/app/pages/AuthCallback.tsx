import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { isLocalConnection, api } from "../lib/api";
import { UpgradeToHostedDialog } from "../components/UpgradeToHostedDialog";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const { loginWithApiKey } = useAuth();
  const navigate = useNavigate();
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");
  const isLocal = isLocalConnection();

  const [error, setError] = useState<string | null>(
    token ? null : "No authentication token received",
  );
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [localEntryCount, setLocalEntryCount] = useState(0);

  useEffect(() => {
    if (!token) {
      setTimeout(() => navigate("/login"), 3000);
      return;
    }

    // Clear the hash from URL for security
    window.history.replaceState(null, "", window.location.pathname);

    loginWithApiKey(token)
      .then(async () => {
        if (isLocal) {
          // Fetch local entry count and show upgrade dialog
          try {
            const data = await api.get<{ entries: unknown[]; total: number }>(
              "/vault/entries?limit=1",
            );
            setLocalEntryCount(data.total);
          } catch {}
          setShowUpgrade(true);
        } else {
          navigate("/");
        }
      })
      .catch(() => {
        setError("Authentication failed");
        setTimeout(() => navigate("/login"), 3000);
      });
  }, [token, loginWithApiKey, navigate, isLocal]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground">
              Redirecting to login...
            </p>
          </>
        ) : !showUpgrade ? (
          <>
            <Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Signing you in...</p>
          </>
        ) : null}
      </div>

      {/* Upgrade to hosted dialog */}
      {token && (
        <UpgradeToHostedDialog
          open={showUpgrade}
          onOpenChange={setShowUpgrade}
          hostedToken={token}
          entryCount={localEntryCount}
        />
      )}
    </div>
  );
}
