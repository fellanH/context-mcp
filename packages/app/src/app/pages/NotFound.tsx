import { Link, useRouteError, isRouteErrorResponse } from "react-router";
import { Button } from "../components/ui/button";
import { ArrowLeft, FileQuestion } from "lucide-react";

export function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
            <FileQuestion className="size-8 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">404</h1>
          <p className="text-muted-foreground">
            This page doesn't exist. It may have been moved or the URL might be
            incorrect.
          </p>
        </div>
        <Link to="/">
          <Button variant="default" className="gap-2">
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function RootErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex justify-center">
          <div className="size-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <span className="text-2xl font-bold text-destructive">!</span>
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Something went wrong
          </h1>
          <p className="text-muted-foreground">
            An unexpected error occurred. Try refreshing the page.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Refresh page
          </Button>
          <Link to="/">
            <Button variant="default" className="gap-2">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
