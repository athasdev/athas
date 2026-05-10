import { CaretRight, Circle, CircleNotch, Pause, Stack, Trash } from "@phosphor-icons/react";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getBaseName } from "@/utils/path-helpers";
import type { DebugBreakpoint, DebugStackFrame } from "../types/debugger";

export const EMPTY_DEBUG_SECTION_MESSAGES = {
  stack: "Start a session to see frames.",
  variables: "Pause on a frame to inspect values.",
  console: "Adapter output appears here.",
  breakpoints: "Click a gutter line or toggle the current line.",
};

const debugSectionVariants = cva(
  "flex min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-secondary-bg/30",
);

export function DebugSection({
  title,
  count,
  children,
  defaultOpen = true,
  action,
  className,
  contentClassName,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={cn(debugSectionVariants(), className)}>
      <div className="flex h-8 shrink-0 items-center gap-1 border-border/60 border-b px-1.5">
        <button
          type="button"
          className="ui-font flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-text-lighter hover:bg-hover/60 hover:text-text"
          onClick={() => setIsOpen((current) => !current)}
        >
          <CaretRight
            size={12}
            className={cn("shrink-0 transition-transform", isOpen && "rotate-90")}
          />
          <span className="min-w-0 flex-1 truncate font-medium ui-text-xs uppercase">{title}</span>
          {typeof count === "number" ? (
            <Badge size="compact" variant="muted" className="h-5 tabular-nums">
              {count}
            </Badge>
          ) : null}
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {isOpen ? (
        <div className={cn("min-h-0 flex-1 overflow-auto", contentClassName)}>{children}</div>
      ) : null}
    </section>
  );
}

export function DebugEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="ui-font px-3 py-6 text-center text-text-lighter ui-text-xs">{children}</div>
  );
}

export function DebugSessionStatusIcon({ status }: { status: "idle" | "running" | "paused" }) {
  if (status === "running") {
    return <CircleNotch size={12} className="shrink-0 animate-spin text-success" />;
  }

  if (status === "paused") {
    return <Pause size={12} className="shrink-0 text-warning" weight="fill" />;
  }

  return <Circle size={10} className="shrink-0 text-text-lighter" weight="fill" />;
}

export function DebugStackFrames({
  frames,
  selectedFrameId,
  onSelect,
}: {
  frames: DebugStackFrame[];
  selectedFrameId: number | null;
  onSelect: (frameId: number, sourcePath?: string, line?: number) => Promise<void>;
}) {
  if (frames.length === 0) {
    return <DebugEmptyState>{EMPTY_DEBUG_SECTION_MESSAGES.stack}</DebugEmptyState>;
  }

  return (
    <div className="py-1">
      {frames.map((frame) => {
        const isSelected = frame.id === selectedFrameId;
        return (
          <button
            key={frame.id}
            type="button"
            className={cn(
              "ui-font flex w-full items-start gap-2 px-3 py-1.5 text-left ui-text-xs hover:bg-hover/70",
              isSelected && "bg-selected/70",
            )}
            onClick={() => void onSelect(frame.id, frame.sourcePath, frame.line)}
          >
            <Stack size={13} className="mt-0.5 shrink-0 text-text-lighter" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text">{frame.name}</span>
              <span className="block truncate ui-text-xs text-text-lighter">
                {frame.sourcePath
                  ? `${getBaseName(frame.sourcePath, "file")}:${frame.line}`
                  : `Line ${frame.line}`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DebugBreakpointsList({
  breakpoints,
  onOpen,
  onToggle,
  onRemove,
}: {
  breakpoints: DebugBreakpoint[];
  onOpen: (breakpoint: DebugBreakpoint) => Promise<void>;
  onToggle: (breakpoint: DebugBreakpoint) => void;
  onRemove: (breakpoint: DebugBreakpoint) => void;
}) {
  if (breakpoints.length === 0) {
    return <DebugEmptyState>{EMPTY_DEBUG_SECTION_MESSAGES.breakpoints}</DebugEmptyState>;
  }

  return (
    <div className="py-1">
      {breakpoints.map((breakpoint) => (
        <div
          key={breakpoint.id}
          className="group ui-font flex items-center gap-2 px-3 py-1.5 ui-text-xs hover:bg-hover/70"
        >
          <button
            type="button"
            aria-label={breakpoint.enabled ? "Disable breakpoint" : "Enable breakpoint"}
            className={cn(
              "size-3 rounded-full border",
              breakpoint.enabled ? "border-error bg-error" : "border-text-lighter bg-transparent",
            )}
            onClick={() => onToggle(breakpoint)}
          />
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => void onOpen(breakpoint)}
          >
            <div className="truncate text-text">{getBaseName(breakpoint.filePath, "file")}</div>
            <div className="truncate ui-text-xs text-text-lighter">Line {breakpoint.line + 1}</div>
          </button>
          <Button
            variant="ghost"
            className="opacity-0 group-hover:opacity-100"
            tooltip="Remove breakpoint"
            onClick={() => onRemove(breakpoint)}
            compact
          >
            <Trash />
          </Button>
        </div>
      ))}
    </div>
  );
}
