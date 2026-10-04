import type React from "react";
import { Component, type ReactNode } from "react";
import { EmptyState } from "@/ui/empty";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class TerminalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Terminal Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <EmptyState
            tone="error"
            role="alert"
            title="Terminal failed to start"
            message={this.state.error?.message || "Failed to initialize terminal"}
            action={{
              label: "Retry",
              onClick: () => this.setState({ hasError: false, error: undefined }),
            }}
          />
        )
      );
    }

    return this.props.children;
  }
}
