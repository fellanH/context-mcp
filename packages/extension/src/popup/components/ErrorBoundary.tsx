import React from "react";

interface Props {
  children: React.ReactNode;
  /** Optional label to identify which view crashed (e.g. "Search", "Capture") */
  label?: string;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.error(
      `[context-vault:ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`,
      error,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center">
          <div className="text-sm font-semibold mb-2">
            {this.props.label
              ? `${this.props.label} failed to load`
              : "Something went wrong"}
          </div>
          <div className="text-xs text-muted-foreground mb-4">
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
