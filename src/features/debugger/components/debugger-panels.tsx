import {
  CircleIcon as Circle,
  FolderOpenIcon as FolderOpen,
  PauseIcon as Pause,
  PencilIcon as Pencil,
  StackIcon as Stack,
  TrashIcon as Trash,
} from "@/ui/icons";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { EmptyState } from "@/ui/empty";
import Input from "@/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { getBaseName } from "@/utils/path-helpers";
import type {
  DebugBreakpoint,
  DebugExceptionBreakpointFilter,
  DebugStackFrame,
} from "../types/debugger.types";

export const EMPTY_DEBUG_SECTION_MESSAGES = {
  stack: "Start a session to see frames.",
  variables: "Pause on a frame to inspect values.",
  console: "Adapter output appears here.",
  breakpoints: "Click a gutter line or toggle the current line.",
};

export function DebugSessionStatusIcon({ status }: { status: "idle" | "running" | "paused" }) {
  if (status === "running") {
    return <Spinner label="Running" compact />;
  }

  if (status === "paused") {
    return <Pause size={12} className="shrink-0 text-warning" weight="fill" />;
  }

  return <Circle size={10} className="shrink-0 text-subtle-foreground" weight="fill" />;
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
    return <EmptyState layout="sidebar" message={EMPTY_DEBUG_SECTION_MESSAGES.stack} />;
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
              "font-sans flex w-full items-start gap-2 px-3 py-1.5 text-left ui-text-sm hover:bg-accent/70",
              isSelected && "bg-selected/70",
            )}
            onClick={() => void onSelect(frame.id, frame.sourcePath, frame.line)}
          >
            <Stack size={13} className="mt-0.5 shrink-0 text-subtle-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground">{frame.name}</span>
              <span className="block truncate ui-text-sm text-subtle-foreground">
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
  onUpdateOptions,
  onRemove,
  showEmptyState = true,
}: {
  breakpoints: DebugBreakpoint[];
  onOpen: (breakpoint: DebugBreakpoint) => Promise<void>;
  onToggle: (breakpoint: DebugBreakpoint) => void;
  onUpdateOptions: (
    breakpoint: DebugBreakpoint,
    options: Pick<DebugBreakpoint, "condition" | "hitCondition" | "logMessage">,
  ) => void;
  onRemove: (breakpoint: DebugBreakpoint) => void;
  showEmptyState?: boolean;
}) {
  if (breakpoints.length === 0) {
    return showEmptyState ? (
      <EmptyState layout="sidebar" message={EMPTY_DEBUG_SECTION_MESSAGES.breakpoints} />
    ) : null;
  }

  return (
    <div className="py-1">
      {breakpoints.map((breakpoint) => (
        <ContextMenu key={breakpoint.id}>
          <ContextMenuTrigger
            className="group font-sans flex items-center gap-2 px-3 py-1.5 ui-text-sm hover:bg-accent/70"
            onContextMenu={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label={breakpoint.enabled ? "Disable breakpoint" : "Enable breakpoint"}
              title={breakpoint.message}
              className={cn(
                "size-3 rounded-full border",
                breakpoint.enabled && breakpoint.verified !== false
                  ? "border-destructive bg-destructive"
                  : breakpoint.enabled
                    ? "border-warning bg-warning/30"
                    : "border-subtle-foreground bg-transparent",
              )}
              onClick={() => onToggle(breakpoint)}
            />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => void onOpen(breakpoint)}
            >
              <div className="truncate text-foreground">
                {getBaseName(breakpoint.filePath, "file")}
              </div>
              <div className="truncate ui-text-sm text-subtle-foreground">
                Line {breakpoint.line + 1}
              </div>
            </button>
            <BreakpointOptions
              breakpoint={breakpoint}
              onUpdate={(options) => onUpdateOptions(breakpoint, options)}
            />
            <Button
              variant="ghost"
              className="opacity-0 group-hover:opacity-100"
              tooltip="Remove breakpoint"
              onClick={() => onRemove(breakpoint)}
              iconOnly
            >
              <Trash />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => void onOpen(breakpoint)}>
              <FolderOpen />
              Go to Breakpoint
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onToggle(breakpoint)}>
              <Circle />
              {breakpoint.enabled ? "Disable Breakpoint" : "Enable Breakpoint"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => onRemove(breakpoint)}>
              <Trash />
              Remove Breakpoint
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}

export function DebugExceptionBreakpointsList({
  filters,
  enabledFilters,
  onToggle,
}: {
  filters: DebugExceptionBreakpointFilter[];
  enabledFilters: Set<string>;
  onToggle: (filter: DebugExceptionBreakpointFilter, enabled: boolean) => void;
}) {
  if (filters.length === 0) return null;

  return (
    <div className="border-border/60 border-b py-1">
      {filters.map((filter) => (
        <label
          key={filter.filter}
          className="font-sans flex items-start gap-2 px-3 py-1.5 ui-text-sm hover:bg-accent/70"
          title={filter.description}
        >
          <Checkbox
            checked={enabledFilters.has(filter.filter)}
            onCheckedChange={(checked) => onToggle(filter, checked === true)}
            aria-label={`${filter.label} exception breakpoint`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-foreground">{filter.label}</span>
            {filter.description ? (
              <span className="block truncate text-subtle-foreground ui-text-sm">
                {filter.description}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function BreakpointOptions({
  breakpoint,
  onUpdate,
}: {
  breakpoint: DebugBreakpoint;
  onUpdate: (options: Pick<DebugBreakpoint, "condition" | "hitCondition" | "logMessage">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState(breakpoint.condition ?? "");
  const [hitCondition, setHitCondition] = useState(breakpoint.hitCondition ?? "");
  const [logMessage, setLogMessage] = useState(breakpoint.logMessage ?? "");

  const save = () => {
    onUpdate({
      condition: condition.trim() || undefined,
      hitCondition: hitCondition.trim() || undefined,
      logMessage: logMessage.trim() || undefined,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="opacity-0 group-hover:opacity-100"
            tooltip="Edit breakpoint"
            iconOnly
          />
        }
      >
        <Pencil />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverTitle>Breakpoint options</PopoverTitle>
        <label className="flex flex-col gap-1 text-subtle-foreground ui-text-sm">
          Condition
          <Input
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
            placeholder="count > 10"
          />
        </label>
        <label className="flex flex-col gap-1 text-subtle-foreground ui-text-sm">
          Hit count
          <Input
            value={hitCondition}
            onChange={(event) => setHitCondition(event.target.value)}
            placeholder="5 or >= 5"
          />
        </label>
        <label className="flex flex-col gap-1 text-subtle-foreground ui-text-sm">
          Log message
          <Input
            value={logMessage}
            onChange={(event) => setLogMessage(event.target.value)}
            placeholder="value = {value}"
          />
        </label>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
