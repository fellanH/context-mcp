import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { posts } from "../content/posts";

export function BlogIndexPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
      <div className="max-w-3xl">
        <Badge variant="outline">Blog</Badge>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Guides for shipping persistent AI memory
        </h1>
        <p className="mt-3 text-muted-foreground">
          Integration tutorials, architecture deep-dives, and conversion-focused
          playbooks for Context Vault users.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {posts.map((post) => (
          <Card key={post.slug}>
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{post.category}</Badge>
                <span>{post.publishedAt}</span>
                <span>{post.readTimeMinutes} min read</span>
              </div>
              <div>
                <CardTitle className="text-lg">
                  <Link to={`/blog/${post.slug}`} className="hover:underline">
                    {post.title}
                  </Link>
                </CardTitle>
                <CardDescription className="mt-2">
                  {post.description}
                </CardDescription>
              </div>
              <Button asChild variant="outline" className="w-fit">
                <Link to={`/blog/${post.slug}`}>
                  Read post <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardFooter />
          </Card>
        ))}
      </div>
    </main>
  );
}
