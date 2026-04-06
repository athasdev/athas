import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/ui/button";

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
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <AlertTriangle className="size-8 text-yellow-500" />
          <div>
            <p className="font-medium text-sm text-text">{this.props.name} crashed</p>
            <p className="mt-1 text-text-lighter text-xs">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
          </div>
          <Button
            onClick={this.handleRetry}
            variant="secondary"
            size="sm"
            aria-label={`Retry loading ${this.props.name}`}
          >
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
