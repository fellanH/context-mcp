import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { UsageMeter } from "../../components/UsageMeter";
import { TierBadge } from "../../components/TierBadge";
import { Check, Loader2, Cloud } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { Link } from "react-router";
import { useUsage, useCheckout } from "../../lib/hooks";
import { formatMegabytes } from "../../lib/format";
import { toast } from "sonner";

const plans = [
  {
    tier: "free" as const,
    price: "$0",
    features: [
      "500 entries",
      "10 MB storage",
      "200 requests/day",
      "1 API key",
      "Community support",
    ],
  },
  {
    tier: "pro" as const,
    price: "$9",
    period: "/mo",
    features: [
      "Unlimited entries",
      "1 GB storage",
      "Unlimited requests",
      "Unlimited API keys",
      "Export/Import",
      "Priority support",
    ],
  },
  {
    tier: "team" as const,
    price: "$29",
    period: "/mo",
    features: [
      "Unlimited entries",
      "10 GB storage",
      "Unlimited requests",
      "Unlimited API keys",
      "Team sharing",
      "SSO",
      "Dedicated support",
    ],
  },
];

export function Billing() {
  const { user, vaultMode } = useAuth();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const checkoutMutation = useCheckout();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLocalMode = vaultMode === "local";

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") {
      toast.success("Welcome to your new plan!");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleUpgrade = (tier: string) => {
    if (tier === "team") {
      toast.info("Contact us at team@context-vault.com for Team plans");
      return;
    }
    checkoutMutation.mutate(
      {
        successUrl: `${window.location.origin}/settings/billing?upgraded=true`,
        cancelUrl: window.location.href,
      },
      {
        onSuccess: (data) => {
          window.location.href = data.url;
        },
        onError: () => {
          toast.error("Failed to start checkout");
        },
      },
    );
  };

  const currentTier = user?.tier ?? "free";

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your plan and view usage.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Current Plan</CardTitle>
            <TierBadge tier={currentTier} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-1.5 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : usage ? (
            <>
              <UsageMeter
                used={usage.entries.used}
                limit={usage.entries.limit}
                label="Entries"
              />
              <UsageMeter
                used={usage.storage.usedMb}
                limit={usage.storage.limitMb}
                label="Storage"
                unit="MB"
                formatValue={formatMegabytes}
              />
              {usage.requestsToday.limit === Infinity ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Requests today
                    </span>
                    <span className="font-mono">
                      {usage.requestsToday.used} (unlimited)
                    </span>
                  </div>
                </div>
              ) : (
                <UsageMeter
                  used={usage.requestsToday.used}
                  limit={usage.requestsToday.limit}
                  label="Requests today"
                />
              )}
              {usage.apiKeys.limit === Infinity ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">API keys</span>
                    <span className="font-mono">
                      {usage.apiKeys.active} (unlimited)
                    </span>
                  </div>
                </div>
              ) : (
                <UsageMeter
                  used={usage.apiKeys.active}
                  limit={usage.apiKeys.limit}
                  label="API keys"
                />
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      {isLocalMode ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-6 space-y-3">
            <div className="flex items-center gap-3">
              <Cloud className="size-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  Billing is available on hosted accounts
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your local vault has no usage limits. To access cloud features
                  like sync, backup, and team sharing, create a hosted account.
                </p>
              </div>
            </div>
            <Button variant="default" size="sm" asChild>
              <Link to="/register">Create cloud account</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            return (
              <Card
                key={plan.tier}
                className={isCurrent ? "border-primary" : ""}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base capitalize">
                      {plan.tier}
                    </CardTitle>
                    {isCurrent && (
                      <Badge variant="outline" className="text-[10px]">
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-bold">{plan.price}</span>
                    {plan.period && (
                      <span className="text-sm text-muted-foreground">
                        {plan.period}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-4">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Check className="size-3.5 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {!isCurrent && (
                    <Button
                      className="w-full"
                      variant={plan.tier === "pro" ? "default" : "outline"}
                      disabled={checkoutMutation.isPending}
                      onClick={() => handleUpgrade(plan.tier)}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : null}
                      {plan.tier === "pro" ? "Upgrade to Pro" : "Contact Sales"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
