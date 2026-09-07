import {
  ArrowClockwiseIcon,
  ArrowDownToLineIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  OpenExternalIcon,
  SearchIcon,
  TextAlignJustifyIcon,
} from "@/ui/icons";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import Input from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import { Spinner } from "@/ui/spinner";
import { Toggle } from "@/ui/toggle";
import { cn } from "@/utils/cn";
import type { WorkflowRunJob, WorkflowRunStep } from "../types/github.types";
import type { WorkflowLogColor, WorkflowLogLine } from "../utils/github-workflow-logs";
import {
  formatWorkflowDuration,
  getWorkflowJobTiming,
  getWorkflowRunState,
  getWorkflowStepTiming,
} from "../utils/github-workflow-status";
import { WORKFLOW_TONE_TEXT_CLASS, WorkflowStatusIcon } from "./github-workflow-status-icon";

const COLOR_CLASS: Record<Exclude<WorkflowLogColor, null>, string> = {
  red: "text-destructive",
  green: "text-success",
  yellow: "text-warning",
  blue: "text-primary",
  magenta: "text-primary",
  cyan: "text-primary",
  gray: "text-subtle-foreground",
};

function formatTimestamp(value: string | null) {
  if (!value) return "";
  const match = value.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function highlightSegments(text: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [{ text, isMatch: false }];

  const lowerText = text.toLowerCase();
  const parts: Array<{ text: string; isMatch: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) break;
    if (matchIndex > cursor) parts.push({ text: text.slice(cursor, matchIndex), isMatch: false });
    const matchEnd = matchIndex + normalizedQuery.length;
    parts.push({ text: text.slice(matchIndex, matchEnd), isMatch: true });
    cursor = matchEnd;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), isMatch: false });
  return parts.length > 0 ? parts : [{ text, isMatch: false }];
}

interface LogLineRowProps {
  line: WorkflowLogLine;
  query: string;
  showTimestamps: boolean;
  wrap: boolean;
  isHighlighted: boolean;
  isCollapsed: boolean;
  onToggleGroup?: () => void;
}

const LogLineRow = memo(
  ({
    line,
    query,
    showTimestamps,
    wrap,
    isHighlighted,
    isCollapsed,
    onToggleGroup,
  }: LogLineRowProps) => {
    const isGroup = line.level === "group";
    const Chevron = isCollapsed ? ChevronRightIcon : ChevronDownIcon;

    const content =
      line.level === null ? (
        line.segments.map((segment, index) => (
          <span
            key={index}
            className={cn(
              segment.color && COLOR_CLASS[segment.color],
              segment.bold && "font-semibold",
            )}
          >
            {highlightSegments(segment.text, query).map((part, partIndex) =>
              part.isMatch ? (
                <mark key={partIndex} className="rounded-xs bg-warning/25 text-foreground">
                  {part.text}
                </mark>
              ) : (
                <span key={partIndex}>{part.text}</span>
              ),
            )}
          </span>
        ))
      ) : (
        <>
          {line.level !== "group" ? (
            <span className="mr-2 select-none font-medium uppercase ui-text-caption opacity-80">
              {line.level}
            </span>
          ) : null}
          {highlightSegments(line.text, query).map((part, partIndex) =>
            part.isMatch ? (
              <mark key={partIndex} className="rounded-xs bg-warning/25 text-foreground">
                {part.text}
              </mark>
            ) : (
              <span key={partIndex}>{part.text}</span>
            ),
          )}
        </>
      );

    const row = (
      <>
        <span className="sticky left-0 w-12 shrink-0 select-none pr-3 text-right tabular-nums text-subtle-foreground/70">
          {line.index + 1}
        </span>
        {showTimestamps ? (
          <span className="mr-3 shrink-0 select-none tabular-nums text-subtle-foreground/70">
            {formatTimestamp(line.timestamp)}
          </span>
        ) : null}
        {isGroup ? <Chevron className="mr-1 shrink-0 self-center text-subtle-foreground" /> : null}
        <span
          className={cn(
            "min-w-0 flex-1",
            wrap ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre",
          )}
        >
          {content}
        </span>
      </>
    );

    const className = cn(
      "flex min-h-5 items-start px-3 font-mono leading-5 ui-text-sm [content-visibility:auto] [contain-intrinsic-size:auto_1.25rem]",
      line.level === "error" && "bg-destructive/10 text-destructive",
      line.level === "warning" && "bg-warning/10 text-warning",
      line.level === "notice" && "bg-primary/8 text-foreground",
      line.level === "debug" && "text-subtle-foreground/70",
      line.level === "command" && "text-primary",
      isGroup && "cursor-default font-medium text-foreground hover:bg-accent/40",
      line.level === null && "text-muted-foreground",
      isHighlighted && "bg-warning/15 ring-1 ring-warning/40 ring-inset",
    );

    if (isGroup) {
      return (
        <button
          type="button"
          data-log-line={line.index}
          aria-expanded={!isCollapsed}
          onClick={onToggleGroup}
          className={cn(className, "w-full text-left")}
        >
          {row}
        </button>
      );
    }

    return (
      <div data-log-line={line.index} className={className}>
        {row}
      </div>
    );
  },
);

LogLineRow.displayName = "LogLineRow";

interface GitHubActionLogPanelProps {
  job: WorkflowRunJob | null;
  step: WorkflowRunStep | null;
  lines: WorkflowLogLine[];
  now: number;
  isLoading: boolean;
  isLogsAvailable: boolean;
  error: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  showTimestamps: boolean;
  onToggleTimestamps: () => void;
  wrap: boolean;
  onToggleWrap: () => void;
  highlightLineIndex: number | null;
  isLive: boolean;
  onRefresh: () => void;
  onCopy: () => void;
  onOpenOnGitHub: (() => void) | null;
}

export function GitHubActionLogPanel({
  job,
  step,
  lines,
  now,
  isLoading,
  isLogsAvailable,
  error,
  query,
  onQueryChange,
  showTimestamps,
  onToggleTimestamps,
  wrap,
  onToggleWrap,
  highlightLineIndex,
  isLive,
  onRefresh,
  onCopy,
  onOpenOnGitHub,
}: GitHubActionLogPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(() => new Set());
  const [followTail, setFollowTail] = useState(true);
  const subject = step ?? job;
  const subjectState = subject ? getWorkflowRunState(subject.status, subject.conclusion) : null;
  const subjectDuration = step
    ? formatWorkflowDuration(getWorkflowStepTiming(step, now).durationMs)
    : job
      ? formatWorkflowDuration(getWorkflowJobTiming(job, now).durationMs)
      : null;

  const visibleLines = useMemo(() => {
    const result: WorkflowLogLine[] = [];
    let hiddenDepth = 0;
    for (const line of lines) {
      if (hiddenDepth > 0) {
        if (line.level === "group") hiddenDepth += 1;
        if (line.level === "endgroup") hiddenDepth -= 1;
        continue;
      }
      if (line.level === "endgroup") continue;
      result.push(line);
      if (line.level === "group" && collapsedGroups.has(line.index)) hiddenDepth = 1;
    }
    return result;
  }, [collapsedGroups, lines]);

  useEffect(() => {
    setCollapsedGroups(new Set());
    setFollowTail(true);
  }, [job?.id, step?.name]);

  useEffect(() => {
    if (highlightLineIndex === null) return;
    const frameId = window.requestAnimationFrame(() => {
      const target = viewportRef.current?.querySelector<HTMLElement>(
        `[data-log-line="${highlightLineIndex}"]`,
      );
      target?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [highlightLineIndex, lines]);

  useEffect(() => {
    if (!isLive || !followTail || highlightLineIndex !== null) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [followTail, highlightLineIndex, isLive, visibleLines.length]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setFollowTail(distance < 48);
  };

  const scrollToBottom = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    setFollowTail(true);
  };

  const hasQuery = query.trim().length > 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Job logs">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {subject ? (
            <WorkflowStatusIcon
              status={subject.status}
              conclusion={subject.conclusion}
              className="shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground ui-text-sm">
              {subject?.name ?? "Select a job"}
            </div>
            {subjectState ? (
              <div className="flex items-center gap-1.5 text-subtle-foreground ui-text-caption">
                <span className={WORKFLOW_TONE_TEXT_CLASS[subjectState.tone]}>
                  {subjectState.label}
                </span>
                {subjectDuration ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{subjectDuration}</span>
                  </>
                ) : null}
                {job?.runnerName ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{job.runnerName}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Filter lines"
            aria-label="Filter log lines"
            leftIcon={SearchIcon}
            className="w-44"
          />
          <Toggle
            pressed={showTimestamps}
            onClick={onToggleTimestamps}
            tooltip={showTimestamps ? "Hide timestamps" : "Show timestamps"}
            aria-label="Toggle timestamps"
          >
            <ClockIcon />
          </Toggle>
          <Toggle
            pressed={wrap}
            onClick={onToggleWrap}
            tooltip={wrap ? "Disable line wrap" : "Wrap long lines"}
            aria-label="Toggle line wrap"
          >
            <TextAlignJustifyIcon />
          </Toggle>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Copy logs"
            onClick={onCopy}
            disabled={lines.length === 0}
          >
            <CopyIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Refresh logs"
            onClick={onRefresh}
            disabled={!job || !isLogsAvailable || isLoading}
          >
            {isLoading ? <Spinner label="Loading logs" compact /> : <ArrowClockwiseIcon />}
          </Button>
          {onOpenOnGitHub ? (
            <Button
              type="button"
              variant="ghost"
              iconOnly
              tooltip="Open job on GitHub"
              onClick={onOpenOnGitHub}
            >
              <OpenExternalIcon />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {!job ? (
          <EmptyState className="min-h-32" message="Select a job to read its logs" />
        ) : !isLogsAvailable ? (
          <EmptyState
            className="min-h-32"
            message="Logs become available once this job starts running"
          />
        ) : error ? (
          <EmptyState
            className="min-h-32"
            tone="error"
            message={error}
            action={{ label: "Retry", onClick: onRefresh, disabled: isLoading }}
          />
        ) : isLoading && lines.length === 0 ? (
          <EmptyState
            className="min-h-32"
            message={<Spinner label="Loading logs" showLabel compact />}
          />
        ) : lines.length === 0 ? (
          <EmptyState
            className="min-h-32"
            message={hasQuery ? "No log lines match this filter" : "No log output for this step"}
          />
        ) : (
          <ScrollArea
            orientation={wrap ? "vertical" : "both"}
            className="size-full"
            contentClassName="py-2"
            viewportProps={{ ref: viewportRef, onScroll: handleScroll }}
          >
            {visibleLines.map((line) => (
              <LogLineRow
                key={line.index}
                line={line}
                query={query}
                showTimestamps={showTimestamps}
                wrap={wrap}
                isHighlighted={highlightLineIndex === line.index}
                isCollapsed={collapsedGroups.has(line.index)}
                onToggleGroup={
                  line.level === "group"
                    ? () =>
                        setCollapsedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(line.index)) next.delete(line.index);
                          else next.add(line.index);
                          return next;
                        })
                    : undefined
                }
              />
            ))}
          </ScrollArea>
        )}
        {isLive && !followTail && lines.length > 0 ? (
          <Button
            type="button"
            variant="accent"
            onClick={scrollToBottom}
            className="absolute right-4 bottom-3 shadow-(--shadow-card)"
          >
            <ArrowDownToLineIcon />
            Follow output
          </Button>
        ) : null}
      </div>
    </section>
  );
}
