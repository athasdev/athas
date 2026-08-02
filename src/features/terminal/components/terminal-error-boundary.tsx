import type React from "react";
import { Component, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";

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
          <Empty className="h-full rounded-none bg-background p-4" tone="error" role="alert">
            <EmptyHeader>
              <EmptyTitle>Terminal Error</EmptyTitle>
              <EmptyDescription>
                {this.state.error?.message || "Failed to initialize terminal"}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="default"
                onClick={() => this.setState({ hasError: false, error: undefined })}
              >
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        )
      );
    }

    return this.props.children;
  }
}
