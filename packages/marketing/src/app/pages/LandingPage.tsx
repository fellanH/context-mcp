import { Link } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
  FileCode2,
  Lock,
  Rocket,
  Search,
  Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { posts } from "../content/posts";
import { appHref } from "../lib/links";

const proof = [
  { label: "Install time", value: "< 5 min" },
  { label: "Primary interface", value: "MCP tools" },
  { label: "Data format", value: "Markdown + YAML" },
];

const pillars = [
  {
    icon: Rocket,
    title: "Setup in minutes",
    body: "Install once and connect your AI tools through MCP with a single endpoint.",
  },
  {
    icon: Search,
    title: "Hybrid retrieval",
    body: "Get high-quality context with full-text + semantic search and relevance ranking.",
  },
  {
    icon: Lock,
    title: "Portable by default",
    body: "Your knowledge stays in readable markdown files you control.",
  },
];

const objections = [
  {
    title: "Privacy",
    body: "Run fully local or use hosted mode. Vault data remains isolated per account key.",
  },
  {
    title: "Lock-in risk",
    body: "Files are plain markdown with YAML metadata, so moving data is straightforward.",
  },
  {
    title: "Complexity",
    body: "One endpoint, one setup flow, and a clear first success path for activation.",
  },
];

const faqs = [
  {
    question: "Can I stay fully local?",
    answer:
      "Yes. Context Vault runs entirely on your machine by default. Your data stays in a local folder as markdown files, and the SQLite index never leaves your disk. No account or network connection required.",
  },
  {
    question: "Can I move to hosted later?",
    answer:
      "Yes. Start local and switch to hosted when you need team access or cross-device retrieval. Your entries are portable markdown files, so migration is straightforward with no format conversion.",
  },
  {
    question: "Will this work with my AI client?",
    answer:
      "Context Vault speaks MCP, which is supported by Claude Code, Cursor, Windsurf, and any MCP-compatible client. For tools like ChatGPT, connect via GPT Actions using the hosted API.",
  },
];

export function LandingPage() {
  const featured = posts.slice(0, 3);

  return (
    <main>
      <section className="border-b border-border/70 bg-gradient-to-b from-muted/60 via-background to-background">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <Badge variant="outline" className="mb-4">
              Memory layer for AI agents
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Persistent memory for AI agents.
            </h1>
            <p className="mt-5 text-base text-muted-foreground sm:text-lg">
              Context Vault lets Claude, Cursor, and MCP-compatible workflows
              save and retrieve durable context across sessions.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <a href={appHref("/register")}>
                  Start free <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/get-started">See 2-minute setup</Link>
              </Button>
            </div>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {proof.map((item) => (
              <Card key={item.label} className="border-border/70 bg-card/80">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-sm font-medium">{item.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Stop re-explaining context every session
          </h2>
          <p className="mt-3 text-muted-foreground">
            Your agent should retain what your team already learned. Context
            Vault makes prior decisions, patterns, and notes retrievable as
            first-class context.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {pillars.map((pillar) => (
            <Card key={pillar.title}>
              <CardHeader className="space-y-3">
                <pillar.icon className="size-5 text-primary" />
                <CardTitle className="text-base">{pillar.title}</CardTitle>
                <CardDescription>{pillar.body}</CardDescription>
              </CardHeader>
              <CardFooter />
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-border/70 bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How it works
          </h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="size-4" />
                  1. Install and connect
                </CardTitle>
                <CardDescription>
                  Run setup once and connect your AI client through MCP.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border border-border/70 bg-background p-3 text-xs">
                  npm install -g context-vault{"\n"}context-vault setup
                </pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCode2 className="size-4" />
                  2. Save context while working
                </CardTitle>
                <CardDescription>
                  Capture decisions and patterns with structured kinds and tags.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border border-border/70 bg-background p-3 text-xs">
                  save_context({"{"} kind: "insight", body: "..." {"}"})
                </pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="size-4" />
                  3. Retrieve when needed
                </CardTitle>
                <CardDescription>
                  Pull relevant context with hybrid retrieval and recency-aware
                  ranking.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border border-border/70 bg-background p-3 text-xs">
                  get_context({"{"} query: "database decisions", limit: 5 {"}"})
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Common objections, answered
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {objections.map((item) => (
            <Card key={item.title}>
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.body}</CardDescription>
              </CardHeader>
              <CardFooter />
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-border/70 bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {faqs.map((faq) => (
              <Card key={faq.question}>
                <CardHeader>
                  <CardTitle className="text-base">{faq.question}</CardTitle>
                  <CardDescription>{faq.answer}</CardDescription>
                </CardHeader>
                <CardFooter />
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Latest from the blog
          </h2>
          <Button asChild variant="outline" size="sm">
            <Link to="/blog">View all</Link>
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {featured.map((post) => (
            <Card key={post.slug}>
              <CardHeader>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{post.category}</Badge>
                  <span>{post.readTimeMinutes} min read</span>
                </div>
                <CardTitle className="text-base">
                  <Link to={`/blog/${post.slug}`} className="hover:underline">
                    {post.title}
                  </Link>
                </CardTitle>
                <CardDescription>{post.description}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <Link to={`/blog/${post.slug}`}>
                    Read post <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-6 p-8 text-center sm:p-10">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Ship persistent memory for your AI stack
              </h2>
              <p className="text-muted-foreground">
                Start free, connect in minutes, and turn stateless sessions into
                cumulative knowledge.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <a href={appHref("/register")}>
                  Start free <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/get-started">See 2-minute setup</Link>
              </Button>
            </div>
            <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Local-first
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                Open-core
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                MCP-native
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
