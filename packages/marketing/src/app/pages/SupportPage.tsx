import {
  Bug,
  Lightbulb,
  Chrome,
  BookOpen,
  ArrowRight,
  Github,
} from "lucide-react";
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
    icon: Bug,
    title: "Report a Bug",
    description:
      "Found something that isn't working? Open an issue on GitHub and we'll look into it.",
    link: {
      href: "https://github.com/fellanH/context-vault/issues",
      label: "Open an Issue",
    },
  },
  {
    icon: Lightbulb,
    title: "Feature Requests",
    description:
      "Have an idea for improving Context Vault? Start a discussion and share your thoughts.",
    link: {
      href: "https://github.com/fellanH/context-vault/discussions",
      label: "Start a Discussion",
    },
  },
  {
    icon: Chrome,
    title: "Chrome Extension",
    description:
      "For extension-specific issues (connection errors, save failures, UI problems), please include when reporting:",
    items: [
      "Your Chrome version",
      "Extension version (visible on the extension details page)",
      "Steps to reproduce the issue",
      "Any error messages from the extension popup or browser console",
    ],
  },
  {
    icon: BookOpen,
    title: "Documentation",
    description:
      "Setup guides, configuration options, and usage examples to get you started.",
    link: {
      href: "https://context-vault.com/docs",
      label: "View Docs",
    },
  },
];

export function SupportPage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
        <div className="space-y-3 mb-10 text-center">
          <Badge variant="outline">Support</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Get help with Context Vault
          </h1>
          <p className="text-muted-foreground">
            Bug reports, feature ideas, and documentation
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
                <CardDescription className="text-sm">
                  {section.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {"items" in section && (
                  <ul className="space-y-1.5 text-sm text-muted-foreground mb-4">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {"link" in section && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={section.link.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {section.link.label}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-8 border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <Github className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Still need help?</p>
              <p className="text-sm text-muted-foreground mt-1">
                For anything else, reach out via the project repository.
              </p>
            </div>
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
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
