import { Badge } from "./ui/badge";
import type { BillingTier } from "../lib/types";

const tierConfig: Record<
  BillingTier,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  free: { label: "Free", variant: "secondary" },
  pro: { label: "Pro", variant: "default" },
  team: { label: "Team", variant: "default" },
};

export function TierBadge({ tier }: { tier: BillingTier }) {
  const config = tierConfig[tier];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
