import { Shield, Eye, ShieldOff, Trash2, ArrowRight } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const sections = [
  {
    icon: Shield,
    title: "What we store",
    items: [
      "Your configured Context Vault server URL",
      "Your API key used to authenticate to your own Context Vault server",
      "Temporary rate-limit metadata from server response headers",
    ],
  },
  {
    icon: Eye,
    title: "How data is used",
    items: [
      "Selected text is sent only to the server URL you configure",
      "Search queries are sent only to your configured server",
      "No analytics, ad tracking, or third-party telemetry is collected by this extension",
    ],
  },
  {
    icon: ShieldOff,
    title: "What we don't collect",
    items: [
      "No browsing history collection beyond pages where the content script runs",
      "No sale or sharing of personal data",
      "No transfer of data to external processors outside your configured Context Vault server",
    ],
  },
  {
    icon: Trash2,
    title: "Deleting your data",
    description:
      "Remove stored extension settings from Chrome by opening extension settings and clearing values, or uninstall the extension to remove locally stored data. To delete vault entries, use your Context Vault app or API.",
  },
] as const;

export function PrivacyPage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <div className="space-y-3 mb-10 text-center">
          <Badge variant="outline">Privacy Policy</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your data stays yours
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: February 19, 2026
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
                  <CardDescription className="text-sm">
                    {section.description}
                  </CardDescription>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            Questions about privacy? Check the project repository.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://github.com/fellanH/context-vault"
              target="_blank"
              rel="noreferrer"
            >
              GitHub Repository
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </section>
    </main>
  );
}
