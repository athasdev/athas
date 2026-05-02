import { CaretRight, Circle, CircleNotch, Pause, Stack, Trash } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
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

export function DebugSection({
  title,
  count,
  children,
  defaultOpen = true,
  action,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="border-border/70 border-b last:border-b-0">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-hover/50"
        onClick={() => setIsOpen((current) => !current)}
      >
        <CaretRight
          size={12}
          className={cn("shrink-0 text-text-lighter transition-transform", isOpen && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-[11px] text-text-lighter uppercase tracking-wide">
          {title}
        </span>
        {typeof count === "number" ? (
          <span className="rounded bg-secondary-bg px-1.5 py-0.5 text-[10px] text-text-lighter">
            {count}
          </span>
        ) : null}
        {action}
      </button>
      {isOpen ? children : null}
    </section>
  );
}

export function DebugEmptyState({ children }: { children: ReactNode }) {
  return <div className="px-3 py-4 text-center text-text-lighter text-xs">{children}</div>;
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
              "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover/70",
              isSelected && "bg-hover/80",
            )}
            onClick={() => void onSelect(frame.id, frame.sourcePath, frame.line)}
          >
            <Stack size={13} className="mt-0.5 shrink-0 text-text-lighter" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text">{frame.name}</span>
              <span className="block truncate text-[11px] text-text-lighter">
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
          className="group flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-hover/70"
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
            <div className="truncate text-[11px] text-text-lighter">Line {breakpoint.line + 1}</div>
          </button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="opacity-0 group-hover:opacity-100"
            tooltip="Remove breakpoint"
            onClick={() => onRemove(breakpoint)}
          >
            <Trash />
          </Button>
        </div>
      ))}
    </div>
  );
}
