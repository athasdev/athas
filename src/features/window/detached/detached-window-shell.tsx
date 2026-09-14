import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactNode, useEffect } from "react";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { useSystemAccessibility } from "@/features/settings/hooks/use-system-accessibility";
import TitleBar from "@/features/window/components/title-bar/title-bar";
import { WindowResizeBorder } from "@/features/window/components/window-resize-border";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { DialogServiceProvider } from "@/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Toaster } from "@/ui/sonner";
import { TooltipProvider } from "@/ui/tooltip";

interface DetachedWindowPendingState {
  title: string;
  description: string;
}

interface DetachedWindowShellProps {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  error?: string | null;
  /** Shown instead of the content while the window connects or hands off. */
  pending?: DetachedWindowPendingState | null;
  children: ReactNode;
  /** Extra runtime that only some kinds need, mounted next to the toaster. */
  runtime?: ReactNode;
}

/**
 * The minimal chrome every detached window shares: a title bar with the
 * host's title and actions, the providers a bare window needs, and the
 * error and pending states of the connection to the owner window.
 */
export function DetachedWindowShell({
  title,
  icon,
  actions,
  error,
  pending,
  children,
  runtime,
}: DetachedWindowShellProps) {
  useFontLoading();
  useSystemAccessibility();

  useEffect(() => {
    void getCurrentWindow().setTitle(`${title} — Athas`).catch(console.error);
  }, [title]);

  return (
    <DialogServiceProvider>
      <TooltipProvider>
        <FontStyleInjector />
        <WindowResizeBorder />
        <div
          data-window-surface="content"
          className="athas-layout-shell flex h-dvh flex-col overflow-hidden bg-background"
        >
          <TitleBar showMinimal title={title} titleIcon={icon} titleActions={actions} />
          {error ? (
            <Empty tone="error">
              <EmptyHeader>
                <EmptyTitle>Window error</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : pending ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{pending.title}</EmptyTitle>
                <EmptyDescription>{pending.description}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            children
          )}
        </div>
        <Toaster />
        {runtime}
      </TooltipProvider>
    </DialogServiceProvider>
  );
}
