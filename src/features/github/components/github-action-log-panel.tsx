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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MonacoReadonlyView,
  type MonacoReadonlyEditor,
} from "@/features/editor/components/monaco-readonly-view";
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
import {
  createViewportDecorator,
  ensureWorkflowLogLanguage,
  registerWorkflowLogModel,
  WORKFLOW_LOG_LANGUAGE_ID,
} from "../lib/github-workflow-log-monaco";
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

/**
 * Reveals a line now and again after the next layout passes. Monaco may not
 * know its final height when the viewer first mounts, so a single reveal can
 * land in the wrong place once automatic layout resizes the editor.
 */
function revealLineWhenSettled(
  editor: MonacoReadonlyEditor,
  line: number,
  mode: "center" | "bottom",
): () => void {
  const reveal = () => {
    if (editor.getModel()?.isDisposed()) return;
    if (mode === "center") editor.revealLineInCenter(line);
    else editor.revealLine(line);
  };
  reveal();
  const layoutDisposable = editor.onDidLayoutChange(reveal);
  const timer = window.setTimeout(() => layoutDisposable.dispose(), REVEAL_SETTLE_MS);
  return () => {
    layoutDisposable.dispose();
    window.clearTimeout(timer);
  };
}

// The language must exist before the first model is created with it, so this
// runs at module load rather than in an effect that fires after the editor.
ensureWorkflowLogLanguage();

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
  const editorRef = useRef<MonacoReadonlyEditor | null>(null);
  const decoratorRef = useRef<ReturnType<typeof createViewportDecorator> | null>(null);
  const unregisterModelRef = useRef<(() => void) | null>(null);
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
  const modelRef = useRef(model);
  modelRef.current = model;

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
    unregisterModelRef.current?.();
    unregisterModelRef.current = registerWorkflowLogModel(editor, {
      model,
      showTimestamps,
      repoPath,
    });
    decoratorRef.current?.update({
      model,
      showTimestamps,
      highlightLine: currentProblemLine,
    });
  }, [currentProblemLine, model, repoPath, showTimestamps]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || currentProblemLine === null) return;
    return revealLineWhenSettled(editor, currentProblemLine, "center");
  }, [currentProblemLine]);

  const updateFollowTail = useCallback((editor: MonacoReadonlyEditor) => {
    const distance =
      editor.getScrollHeight() - editor.getScrollTop() - editor.getLayoutInfo().height;
    const next = distance < TAIL_THRESHOLD_PX;
    if (followTailRef.current === next) return;
    followTailRef.current = next;
    setFollowTail(next);
  }, []);

  const handleReady = useCallback(
    (editor: MonacoReadonlyEditor) => {
      editorRef.current = editor;
      const decorator = createViewportDecorator(editor);
      decoratorRef.current = decorator;
      unregisterModelRef.current = registerWorkflowLogModel(editor, {
        model: modelRef.current,
        showTimestamps,
        repoPath,
      });
      decorator.update({
        model: modelRef.current,
        showTimestamps,
        highlightLine: currentProblemLine,
      });
      const scrollDisposable = editor.onDidScrollChange((event) => {
        if (event.scrollTopChanged || event.scrollHeightChanged) updateFollowTail(editor);
      });
      const cancelReveal =
        currentProblemLine !== null
          ? revealLineWhenSettled(editor, currentProblemLine, "center")
          : isLive && followTailRef.current
            ? revealLineWhenSettled(editor, editor.getModel()?.getLineCount() ?? 1, "bottom")
            : null;

      return () => {
        cancelReveal?.();
        scrollDisposable.dispose();
        decorator.dispose();
        unregisterModelRef.current?.();
        unregisterModelRef.current = null;
        decoratorRef.current = null;
        editorRef.current = null;
      };
    },
    // Only the initial values matter here; later changes are synced by effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleContentApplied = useCallback(
    (editor: MonacoReadonlyEditor, appended: boolean) => {
      if (isLive && followTailRef.current && currentProblemLine === null) {
        const lastLine = editor.getModel()?.getLineCount() ?? 1;
        editor.revealLine(lastLine);
      } else if (!appended && currentProblemLine === null) {
        editor.setScrollTop(0);
      }
    },
    [currentProblemLine, isLive],
  );

  const scrollToBottom = () => {
    const editor = editorRef.current;
    if (!editor) return;
    followTailRef.current = true;
    setFollowTail(true);
    editor.revealLine(editor.getModel()?.getLineCount() ?? 1);
  };

  const jumpToProblem = (direction: 1 | -1) => {
    const next = findAdjacentProblemLine(model.problemLines, currentProblemLine, direction);
    if (next === null) return;
    followTailRef.current = false;
    setFollowTail(false);
    setActiveProblemLine(next);
  };

  const triggerEditorAction = (action: string) => {
    editorRef.current?.trigger("github-actions-log", action, null);
  };

  const lineNumberFormatter = useCallback((lineNumber: number) => {
    const row = modelRef.current.rows[lineNumber - 1];
    return String(row ? row.index + 1 : lineNumber);
  }, []);

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
                  "rounded-chrome px-1.5 py-0.5 ui-text-caption tabular-nums transition-colors hover:bg-accent/60",
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
                onClick={() => triggerEditorAction("editor.foldAll")}
              >
                Collapse all groups
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={model.foldRanges.length === 0}
                onClick={() => triggerEditorAction("editor.unfoldAll")}
              >
                Expand all groups
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={model.rows.length === 0}
                onClick={() => triggerEditorAction("actions.find")}
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
          <MonacoReadonlyView
            content={model.text}
            languageId={WORKFLOW_LOG_LANGUAGE_ID}
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
