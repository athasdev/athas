import { Component, type ErrorInfo, type ReactNode } from "react";
import { WarningIcon as AlertTriangle } from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";

interface Props {
  extensionId: string;
  name: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ExtensionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Extension "${this.props.extensionId}" crashed:`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Empty className="h-full rounded-none p-4" tone="warning" role="alert">
          <EmptyHeader>
            <EmptyMedia>
              <AlertTriangle className="size-8" />
            </EmptyMedia>
            <EmptyTitle>{this.props.name} crashed</EmptyTitle>
            <EmptyDescription>
              {this.state.error?.message || "An unexpected error occurred"}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={this.handleRetry}
              variant="default"
              aria-label={`Retry loading ${this.props.name}`}
              size="xs"
            >
              Retry
            </Button>
          </EmptyContent>
        </Empty>
      );
    }

    return this.props.children;
  }
}
