import { useState } from "react";
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
import { Copy, Check, Plus, Trash2, Loader2 } from "lucide-react";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { toast } from "sonner";

export function ApiKeys() {
  const { user } = useAuth();
  const { data: keys, isLoading } = useApiKeys();
  const createMutation = useCreateApiKey();
  const deleteMutation = useDeleteApiKey();
  const isLocalMode = user?.id === "local";
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const createKey = () => {
    if (isLocalMode) {
      toast.info("Local mode does not use hosted API keys");
      return;
    }
    if (!newKeyName.trim()) return;
    createMutation.mutate(newKeyName.trim(), {
      onSuccess: (data) => {
        setNewlyCreatedKey(data.key);
        setNewKeyName("");
        setShowCreate(false);
        toast.success(`API key "${newKeyName.trim()}" created`);
      },
      onError: () => {
        toast.error("Failed to create API key");
      },
    });
  };

  const deleteKey = (id: string) => {
    if (isLocalMode) {
      toast.info("Local mode does not use hosted API keys");
      return;
    }
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success("API key deleted");
      },
      onError: () => {
        toast.error("Failed to delete API key");
      },
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyConfig = () =>
    copyToClipboard(
      JSON.stringify(
        {
          mcpServers: {
            "context-vault": {
              url: "https://api.context-vault.com/mcp",
              headers: {
                Authorization: "Bearer YOUR_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
      "Config",
    );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isLocalMode
            ? "Local mode connects directly to your vault and does not require hosted API keys."
            : "Manage your API keys for connecting Context Vault to Claude Code and other tools."}
        </p>
      </div>

      {!isLocalMode && newlyCreatedKey && (
        <Card className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Your new API key (copy it now — it won't be shown again):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white dark:bg-black/20 px-3 py-2 rounded text-xs font-mono border border-green-300 dark:border-green-700 break-all">
                {newlyCreatedKey}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => copyToClipboard(newlyCreatedKey, "API key")}
              >
                {copied === "API key" ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setNewlyCreatedKey(null)}
            >
              I've saved it
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Your Keys</CardTitle>
          {!isLocalMode && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="size-3.5" />
              Create New Key
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!isLocalMode && showCreate && (
            <div className="flex items-end gap-2 mb-4 pb-4 border-b border-border">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="keyName" className="text-xs">
                  Key name
                </Label>
                <Input
                  id="keyName"
                  placeholder="e.g. Development, Production"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createKey()}
                  disabled={createMutation.isPending}
                />
              </div>
              <Button
                size="sm"
                onClick={createKey}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Create"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : !keys || keys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {isLocalMode
                ? "Local mode does not use hosted API keys."
                : "No API keys yet. Create one to get started."}
            </p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg border border-border"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-sm font-medium">{key.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {key.prefix}...
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {key.createdAt.toLocaleDateString()}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {key.lastUsedAt
                        ? `Used ${key.lastUsedAt.toLocaleDateString()}`
                        : "Never used"}
                    </Badge>
                  </div>
                  {!isLocalMode && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteKey(key.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Setup Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLocalMode ? (
            <>
              <p className="text-sm text-muted-foreground">
                Local mode runs on your machine and does not require a hosted
                API key.
              </p>
              <pre className="bg-muted p-4 rounded-lg text-xs font-mono overflow-x-auto">
                {`context-vault ui`}
              </pre>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Add this configuration to your Claude Code MCP settings to
                connect:
              </p>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg text-xs font-mono overflow-x-auto">
                  {`{
  "mcpServers": {
    "context-vault": {
      "url": "https://api.context-vault.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 gap-1.5 text-xs"
                  onClick={copyConfig}
                >
                  {copied === "Config" ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
