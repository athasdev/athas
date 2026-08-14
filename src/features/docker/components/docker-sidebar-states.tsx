import {
  ArrowClockwiseIcon as Refresh,
  ArrowSquareOutIcon as OpenExternal,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "@/ui/icons";
import type { ReactNode } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { getDockerUnavailableCopy } from "../utils/docker-sidebar-utils";

function openDockerConnectionDetailsBuffer(error: string) {
  const copy = getDockerUnavailableCopy(error);
  const content = `${copy.title}\n\n${copy.description}\n\nTechnical details\n${error}\n`;
  const bufferStore = useBufferStore.getState();
  const bufferId = bufferStore.actions.openContent({
    type: "editor",
    path: "docker://connection-details",
    name: "Docker Connection.log",
    content,
    isVirtual: true,
    readOnly: true,
    language: "log",
  });
  const openedBuffer = useBufferStore.getState().buffers.find((buffer) => buffer.id === bufferId);
  if (openedBuffer?.type === "editor") {
    useBufferStore.getState().actions.updateBuffer({
      ...openedBuffer,
      content,
      savedContent: content,
      isDirty: false,
      isVirtual: true,
      readOnly: true,
      language: "log",
    });
  }
}

export function DockerUnavailableState({
  error,
  title,
  description,
  isRetrying,
  onRetry,
}: {
  error: string;
  title?: string;
  description?: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const fallbackCopy = getDockerUnavailableCopy(error);

  return (
    <Empty className="min-h-0 flex-none gap-3 px-4 py-5" role="status">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon" className="size-9 border border-border/70 bg-accent">
          <WarningCircle className="size-4.5 text-subtle-foreground" />
        </EmptyMedia>
        <EmptyTitle className="ui-text-base">{title ?? fallbackCopy.title}</EmptyTitle>
        <EmptyDescription className="max-w-[34ch]">
          {description ?? fallbackCopy.description}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-1.5">
        <Button type="button" variant="default" size="sm" disabled={isRetrying} onClick={onRetry}>
          {isRetrying ? <Spinner compact /> : <Refresh />}
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => openDockerConnectionDetailsBuffer(error)}
        >
          <OpenExternal />
          Details
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function DockerInlineError({
  title,
  error,
  onDismiss,
  className,
}: {
  title: string;
  error: string;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <Alert tone="error" className={cn("min-w-0", className)}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="min-w-0 select-text whitespace-pre-wrap wrap-break-word wrap-anywhere">
        {error}
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tooltip="Dismiss"
          tooltipSide="left"
          aria-label={`Dismiss ${title.toLowerCase()}`}
          onClick={onDismiss}
        >
          <X />
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function DockerCapabilityNotice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert tone="warning" role="status" className={cn("mx-2 mb-2 w-auto", className)}>
      <WarningCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
