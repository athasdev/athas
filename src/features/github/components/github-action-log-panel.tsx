import "../styles/github-workflow-log.css";
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ClockIcon,
  CopyIcon,
  DotsIcon,
  DownloadIcon,
  OpenExternalIcon,
  SearchIcon,
  TextAlignJustifyIcon,
} from "@/ui/icons";
import { foldAll, unfoldAll } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CodeMirrorReadonlyView,
  type ReadonlyEditorView,
} from "@/features/editor/components/codemirror-readonly-view";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { Toggle } from "@/ui/toggle";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { updateWorkflowLog, workflowLogExtension } from "../lib/github-workflow-log-codemirror";
import type { WorkflowRunJob, WorkflowRunStep } from "../types/github.types";
import { buildWorkflowLogModel, findAdjacentProblemLine } from "../utils/github-workflow-log-model";
import type { WorkflowLogLine } from "../utils/github-workflow-logs";
import {
  formatWorkflowDuration,
  getWorkflowJobTiming,
  getWorkflowRunState,
  getWorkflowStepTiming,
} from "../utils/github-workflow-status";
import { WORKFLOW_TONE_TEXT_CLASS, WorkflowStatusIcon } from "./github-workflow-status-icon";

const TAIL_THRESHOLD_PX = 48;
const REVEAL_SETTLE_MS = 600;

function revealLine(view: EditorView, line: number, mode: "center" | "bottom") {
  const { doc } = view.state;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  view.dispatch({
    effects: EditorView.scrollIntoView(target.from, { y: mode === "center" ? "center" : "end" }),
  });
}

/**
 * Reveals a line now and again whenever the viewer resizes shortly after. The
 * editor may not know its final height when it first mounts, so a single
 * reveal can land in the wrong place once layout settles.
 */
function revealLineWhenSettled(
  view: EditorView,
  line: number,
  mode: "center" | "bottom",
): () => void {
  revealLine(view, line, mode);
  if (typeof ResizeObserver === "undefined") return () => undefined;
  const observer = new ResizeObserver(() => revealLine(view, line, mode));
  observer.observe(view.scrollDOM);
  const timer = window.setTimeout(() => observer.disconnect(), REVEAL_SETTLE_MS);
  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

function lastLine(view: EditorView) {
  return view.state.doc.lines;
}

interface GitHubActionLogPanelProps {
  job: WorkflowRunJob | null;
  step: WorkflowRunStep | null;
  lines: WorkflowLogLine[];
  now: number;
  repoPath: string | null;
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
  onExport: () => void;
  onOpenOnGitHub: (() => void) | null;
}

export function GitHubActionLogPanel({
  job,
  step,
  lines,
  now,
  repoPath,
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
  onExport,
  onOpenOnGitHub,
}: GitHubActionLogPanelProps) {
  const editorRef = useRef<ReadonlyEditorView | null>(null);
  const followTailRef = useRef(true);
  const [followTail, setFollowTail] = useState(true);
  const [activeProblemLine, setActiveProblemLine] = useState<number | null>(null);

  const subject = step ?? job;
  const subjectState = subject ? getWorkflowRunState(subject.status, subject.conclusion) : null;
  const subjectDuration = step
    ? formatWorkflowDuration(getWorkflowStepTiming(step, now).durationMs)
    : job
      ? formatWorkflowDuration(getWorkflowJobTiming(job, now).durationMs)
      : null;

  const model = useMemo(
    () => buildWorkflowLogModel(lines, { showTimestamps }),
    [lines, showTimestamps],
  );

  const highlightLine = useMemo(() => {
    if (highlightLineIndex === null) return null;
    const rowIndex = model.rows.findIndex((row) => row.index === highlightLineIndex);
    return rowIndex === -1 ? null : rowIndex + 1;
  }, [highlightLineIndex, model.rows]);

  const currentProblemLine = activeProblemLine ?? highlightLine;

  useEffect(() => {
    setActiveProblemLine(null);
    followTailRef.current = true;
    setFollowTail(true);
  }, [job?.id, step?.name]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    updateWorkflowLog(editor, {
      model,
      showTimestamps,
      highlightLine: currentProblemLine,
      repoPath,
    });
  }, [currentProblemLine, model, repoPath, showTimestamps]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || currentProblemLine === null) return;
    return revealLineWhenSettled(editor, currentProblemLine, "center");
  }, [currentProblemLine]);

  const updateFollowTail = useCallback((editor: ReadonlyEditorView) => {
    const { scrollHeight, scrollTop, clientHeight } = editor.scrollDOM;
    const distance = scrollHeight - scrollTop - clientHeight;
    const next = distance < TAIL_THRESHOLD_PX;
    if (followTailRef.current === next) return;
    followTailRef.current = next;
    setFollowTail(next);
  }, []);

  const handleReady = useCallback(
    (editor: ReadonlyEditorView) => {
      editorRef.current = editor;
      updateWorkflowLog(editor, {
        model,
        showTimestamps,
        highlightLine: currentProblemLine,
        repoPath,
      });
      const handleScroll = () => updateFollowTail(editor);
      editor.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
      const cancelReveal =
        currentProblemLine !== null
          ? revealLineWhenSettled(editor, currentProblemLine, "center")
          : isLive && followTailRef.current
            ? revealLineWhenSettled(editor, lastLine(editor), "bottom")
            : null;

      return () => {
        cancelReveal?.();
        editor.scrollDOM.removeEventListener("scroll", handleScroll);
        editorRef.current = null;
      };
    },
    [currentProblemLine, isLive, model, repoPath, showTimestamps, updateFollowTail],
  );

  const handleContentApplied = useCallback(
    (editor: ReadonlyEditorView, appended: boolean) => {
      if (isLive && followTailRef.current && currentProblemLine === null) {
        revealLine(editor, lastLine(editor), "bottom");
      } else if (!appended && currentProblemLine === null) {
        editor.scrollDOM.scrollTop = 0;
      }
    },
    [currentProblemLine, isLive],
  );

  const scrollToBottom = () => {
    const editor = editorRef.current;
    if (!editor) return;
    followTailRef.current = true;
    setFollowTail(true);
    revealLine(editor, lastLine(editor), "bottom");
  };

  const jumpToProblem = (direction: 1 | -1) => {
    const next = findAdjacentProblemLine(model.problemLines, currentProblemLine, direction);
    if (next === null) return;
    followTailRef.current = false;
    setFollowTail(false);
    setActiveProblemLine(next);
  };

  const runEditorCommand = (command: (view: EditorView) => boolean) => {
    const editor = editorRef.current;
    if (editor) command(editor);
  };

  const lineNumberFormatter = useCallback(
    (lineNumber: number) => {
      const row = model.rows[lineNumber - 1];
      return String(row ? row.index + 1 : lineNumber);
    },
    [model.rows],
  );

  const hasQuery = query.trim().length > 0;
  const problemCount = model.errorCount + model.warningCount;
  const problemLabel = [
    model.errorCount > 0 ? `${model.errorCount} error${model.errorCount === 1 ? "" : "s"}` : null,
    model.warningCount > 0
      ? `${model.warningCount} warning${model.warningCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Job logs">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-border border-b px-3 py-2">
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
                {model.rows.length > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{`${model.rows.length} lines`}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {problemCount > 0 ? (
            <div className="mr-1 flex items-center gap-0.5">
              <Tooltip content="Previous problem">
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  aria-label="Previous problem"
                  onClick={() => jumpToProblem(-1)}
                >
                  <ArrowUpIcon />
                </Button>
              </Tooltip>
              <button
                type="button"
                onClick={() => jumpToProblem(1)}
                className={cn(
                  "rounded-chrome px-1.5 py-0.5 ui-text-caption tabular-nums transition-colors hover:bg-accent",
                  model.errorCount > 0
                    ? WORKFLOW_TONE_TEXT_CLASS.error
                    : WORKFLOW_TONE_TEXT_CLASS.warning,
                )}
                aria-label={`${problemLabel}. Jump to next problem`}
              >
                {problemLabel}
              </button>
              <Tooltip content="Next problem">
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  aria-label="Next problem"
                  onClick={() => jumpToProblem(1)}
                >
                  <ArrowDownIcon />
                </Button>
              </Tooltip>
            </div>
          ) : null}
          <span className="inline-flex min-w-0 w-44">
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Filter lines"
              aria-label="Filter log lines"
              leftIcon={SearchIcon}
            />
          </span>
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
          <DropdownMenu>
            <Tooltip content="More log actions">
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="ghost" iconOnly aria-label="More log actions" />
                }
              >
                <DotsIcon />
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={model.foldRanges.length === 0}
                onClick={() => runEditorCommand(foldAll)}
              >
                Collapse all groups
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={model.foldRanges.length === 0}
                onClick={() => runEditorCommand(unfoldAll)}
              >
                Expand all groups
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={model.rows.length === 0}
                onClick={() => runEditorCommand(openSearchPanel)}
              >
                Find in logs
              </DropdownMenuItem>
              <DropdownMenuItem disabled={lines.length === 0} onClick={onExport}>
                <DownloadIcon />
                Export log
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <CodeMirrorReadonlyView
            content={model.text}
            extensions={workflowLogExtension}
            wordWrap={wrap}
            folding
            lineNumberFormatter={lineNumberFormatter}
            ariaLabel="Job log output"
            onReady={handleReady}
            onContentApplied={handleContentApplied}
          />
        )}
        {isLive && !followTail && lines.length > 0 ? (
          <span className="inline-flex min-w-0 absolute right-4 bottom-3">
            <Button type="button" variant="accent" onClick={scrollToBottom}>
              <ArrowDownToLineIcon />
              Follow output
            </Button>
          </span>
        ) : null}
      </div>
    </section>
  );
}
