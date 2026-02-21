import { useTheme } from "next-themes";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Copy, Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAuth } from "../../lib/auth";
import { useState } from "react";
import { toast } from "sonner";

export function Account() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const copyUserId = async () => {
    if (!user) return;
    await navigator.clipboard.writeText(user.id);
    setCopied(true);
    toast.success("User ID copied");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!user) return null;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your profile and preferences.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Email</Label>
            <Input value={user.email} readOnly className="bg-muted" />
          </div>
          {user.name && (
            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input value={user.name} readOnly className="bg-muted" />
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-xs">User ID</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono">
                {user.id}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={copyUserId}
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Share this with support if you need help.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Member since</Label>
            <p className="text-sm">{user.createdAt.toLocaleDateString()}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Dark mode</Label>
              <p className="text-xs text-muted-foreground">
                Toggle between light and dark theme
              </p>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(checked) =>
                setTheme(checked ? "dark" : "light")
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
