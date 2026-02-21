import { ArrowUpRight } from "lucide-react";
import { Button } from "./ui/button";
import { Link } from "react-router";

interface UpgradePromptProps {
  message?: string;
  compact?: boolean;
}

export function UpgradePrompt({
  message = "Upgrade to Pro for more",
  compact,
}: UpgradePromptProps) {
  if (compact) {
    return (
      <Link to="/settings/billing">
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          Upgrade
          <ArrowUpRight className="size-3" />
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-3">
      <span className="text-sm text-muted-foreground">{message}</span>
      <Link to="/settings/billing">
        <Button size="sm" className="gap-1.5">
          Upgrade to Pro
          <ArrowUpRight className="size-3.5" />
        </Button>
      </Link>
    </div>
  );
}
