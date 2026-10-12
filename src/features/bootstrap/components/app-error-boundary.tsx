import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmptyState } from "@/ui/empty";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The window's last error boundary. Without it, an error thrown while rendering any view
 * unmounts the whole React tree and leaves an empty window behind.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const caught = toError(error);
    console.error("The window failed to render:", caught, info.componentStack);
    void import("@/features/telemetry/services/telemetry")
      .then(({ recordCrashReport }) =>
        recordCrashReport({
          kind: "render_error",
          message: caught.message,
          stack: caught.stack || null,
        }),
      )
      .catch(() => {});
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-dvh w-dvw flex-col overflow-hidden bg-background">
        <div className="h-title-bar shrink-0" data-tauri-drag-region />
        <EmptyState
          tone="error"
          role="alert"
          title="Something went wrong"
          message={error.message || "The window failed to render."}
          action={{ label: "Reload window", onClick: () => window.location.reload() }}
        />
      </div>
    );
  }
}
