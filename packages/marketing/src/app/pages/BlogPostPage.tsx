import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPostBySlug } from "../content/posts";
import { appHref } from "../lib/links";

export function BlogPostPage() {
  const { slug } = useParams();
  const post = getPostBySlug(slug);

  if (!post) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <Card>
          <CardContent className="space-y-4 p-8">
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <p className="text-muted-foreground">
              This article may have moved or no longer exists.
            </p>
            <Button asChild variant="outline">
              <Link to="/blog">
                <ArrowLeft className="size-4" />
                Back to blog
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const ctaHref = post.ctaHref.startsWith("/")
    ? appHref(post.ctaHref)
    : post.ctaHref;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-16">
      <Button asChild variant="ghost" className="mb-4 px-0">
        <Link to="/blog">
          <ArrowLeft className="size-4" />
          Back to blog
        </Link>
      </Button>

      <article className="space-y-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{post.category}</Badge>
            <span>{post.publishedAt}</span>
            <span>{post.readTimeMinutes} min read</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {post.title}
          </h1>
          <p className="text-base text-muted-foreground">{post.description}</p>
        </header>

        <div className="space-y-8">
          {post.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">
                {section.heading}
              </h2>
              <div className="space-y-3 text-foreground/90">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-medium">
                Ready to apply this in your workflow?
              </h3>
              <p className="text-sm text-muted-foreground">
                Connect Context Vault and validate your first memory retrieval.
              </p>
            </div>
            <Button asChild>
              <a href={ctaHref}>
                {post.ctaLabel}
                <ArrowRight className="size-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </article>
    </main>
  );
}
