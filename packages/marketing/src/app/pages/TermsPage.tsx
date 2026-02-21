import {
  FileText,
  UserCheck,
  CreditCard,
  ShieldAlert,
  Ban,
  Mail,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const sections = [
  {
    icon: FileText,
    title: "Acceptance",
    body: 'By accessing or using Context Vault (the "Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.',
  },
  {
    icon: UserCheck,
    title: "Your account",
    items: [
      "You must provide accurate information when registering.",
      "You are responsible for keeping your API keys and credentials secure.",
      "You may not share accounts or resell access to the Service.",
      "You must be at least 16 years old to create an account.",
    ],
  },
  {
    icon: FileText,
    title: "Description of service",
    body: "Context Vault provides a persistent memory layer for AI agents via MCP. The Service is offered as a hosted cloud option and as open-source software you can self-host. Feature availability may differ between tiers.",
  },
  {
    icon: Ban,
    title: "Acceptable use",
    items: [
      "Do not use the Service to store or transmit unlawful content.",
      "Do not attempt to reverse-engineer, scrape, or abuse rate limits.",
      "Do not use the Service to violate third-party rights or any applicable law.",
      "Automated bulk imports must respect the documented rate limits.",
    ],
  },
  {
    icon: CreditCard,
    title: "Billing & subscriptions",
    items: [
      "Paid plans are billed monthly or annually via Stripe.",
      "Downgrades take effect at the end of the current billing period.",
      "Refunds are handled case-by-case — contact support within 7 days of a charge.",
      "We may change pricing with 30 days' notice to active subscribers.",
    ],
  },
  {
    icon: ShieldAlert,
    title: "Disclaimers & liability",
    body: 'The Service is provided "as is" without warranty of any kind. To the fullest extent permitted by law, Context Vault is not liable for indirect, incidental, or consequential damages arising from your use of the Service.',
  },
  {
    icon: FileText,
    title: "Termination",
    body: "We may suspend or terminate your account for material violations of these Terms. You may delete your account at any time from your account settings. Upon termination, your vault data will be deleted within 30 days.",
  },
  {
    icon: Mail,
    title: "Contact",
    body: "Questions about these Terms? Reach us at support@context-vault.com or open an issue at github.com/fellanH/context-vault.",
  },
] as const;

export function TermsPage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <div className="space-y-3 mb-10 text-center">
          <Badge variant="outline">Terms of Service</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: February 20, 2026
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30">
                    <section.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-base">{section.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {"items" in section ? (
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {section.body}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
