import {
  ArrowsLeftRightIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleDottedIcon,
  FileTextIcon,
  GitDiffIcon,
  GlobeIcon,
  PencilLineIcon,
  SearchIcon,
  SlidersIcon,
  TerminalIcon,
  TerminalWindowIcon,
  TrashIcon,
  WarningCircleIcon,
  WrenchIcon,
  type Icon,
} from "@/ui/icons";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createAcpDiffViewNode,
  getAcpDiffOutputs,
  openAcpDiffOutput,
  stripAcpDiffOutputs,
} from "@/features/ai/lib/acp-diff-output";
import {
  getStructuredToolViews,
  isStructuredToolViewEnvelope,
  stripStructuredToolViews,
} from "@/features/ai/lib/structured-tool-view";
import {
  getAcpTerminalOutputs,
  openAcpTerminalOutput,
} from "@/features/ai/lib/acp-terminal-output";
import {
  createAcpToolLocationTree,
  OPEN_TOOL_LOCATION_COMMAND,
} from "@/features/ai/lib/acp-tool-location-tree";
import { summarizeToolCall, type ToolCallSummary } from "@/features/ai/lib/tool-call-summary";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AcpToolKind } from "@/features/ai/types/acp.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { getFileDiff } from "@/features/git/api/git-diff-api";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { Shimmer } from "@/ui/shimmer";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import { ExtensionViewRenderer } from "@/extensions/ui/components/extension-view-renderer";
import { getBaseName, joinPath } from "@/utils/path-helpers";
import { cn } from "@/utils/cn";

const KIND_ICONS: Record<AcpToolKind, Icon> = {
  read: FileTextIcon,
  edit: PencilLineIcon,
  delete: TrashIcon,
  move: ArrowsLeftRightIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: GlobeIcon,
  switch_mode: SlidersIcon,
  other: WrenchIcon,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("remote://");
}

function resolveWorkspacePath(path: string): string {
  if (isAbsolutePath(path)) return path;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  return rootFolderPath ? joinPath(rootFolderPath, path) : path;
}

async function openToolPath(path: string) {
  const resolvedPath = resolveWorkspacePath(path);
  const content = await readFileContent(resolvedPath);
  const bufferId = useBufferStore
    .getState()
    .actions.openBuffer(resolvedPath, getBaseName(resolvedPath), content);
  useBufferStore.getState().actions.setActiveBuffer(bufferId);
}

async function openToolDiff(path: string, output: unknown) {
  if (openAcpDiffOutput(output)) return;

  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  const resolvedPath = resolveWorkspacePath(path);
  const repoPath = rootFolderPath ?? resolvedPath;
  const diff = await getFileDiff(repoPath, path);

  if (diff) {
    useBufferStore
      .getState()
      .actions.openBuffer(
        `diff://acp-tool-output/${Date.now()}`,
        `${getBaseName(diff.file_path)}.diff`,
        "",
        false,
        undefined,
        true,
        true,
        diff,
      );
    return;
  }

  const newText = await readFileContent(resolvedPath);
  openAcpDiffOutput([{ type: "diff", path: resolvedPath, oldText: "", newText }]);
}

/** Text worth showing for a tool result once diffs and views are taken out. */
function getOutputText(output: unknown): string {
  if (output === undefined || output === null || isStructuredToolViewEnvelope(output)) return "";

  if (isRecord(output)) {
    // The built-in shell tool.
    if (typeof output.stdout === "string" || typeof output.stderr === "string") {
      const parts = [output.stdout, output.stderr].filter(
        (part): part is string => typeof part === "string" && part.trim().length > 0,
      );
      if (output.timed_out === true) parts.push("(timed out)");
      else if (typeof output.exit_code === "number" && output.exit_code !== 0) {
        parts.push(`(exit code ${output.exit_code})`);
      }
      return parts.join("\n").trim();
    }
    // The built-in read tool.
    if (typeof output.text === "string") return output.text;
    if (typeof output.reason === "string") return output.reason;
    return formatValue(output);
  }

  if (!Array.isArray(output)) return formatValue(output);

  return output
    .map((item) => {
      if (isStructuredToolViewEnvelope(item)) return "";
      if (!isRecord(item)) return formatValue(item);
      // ACP content blocks.
      if (item.type === "content" && isRecord(item.content)) {
        return item.content.type === "text" && typeof item.content.text === "string"
          ? item.content.text
          : formatValue(item.content);
      }
      if (item.type === "terminal") return "";
      // The built-in search tool.
      if (typeof item.path === "string" && typeof item.line === "number") {
        return `${item.path}:${item.line}  ${typeof item.text === "string" ? item.text.trim() : ""}`;
      }
      return formatValue(item);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function OutputBlock({ text, tone = "default" }: { text: string; tone?: "default" | "error" }) {
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto rounded-lg border border-border bg-surface px-2.5 py-2 font-mono whitespace-pre-wrap wrap-anywhere select-text ui-text-sm",
        tone === "error" ? "text-destructive" : "text-subtle-foreground",
      )}
    >
      {text}
    </pre>
  );
}

function ToolCallStats({ summary }: { summary: ToolCallSummary }) {
  if (summary.phase === "failed") {
    return (
      <span className="shrink-0 text-destructive">
        failed
        {summary.error ? <span className="text-destructive"> · {summary.error}</span> : null}
      </span>
    );
  }
  if (summary.phase === "declined") {
    return <span className="shrink-0 text-subtle-foreground">declined</span>;
  }
  if (summary.additions > 0 || summary.deletions > 0) {
    return (
      <span className="shrink-0 tabular-nums">
        {summary.additions > 0 ? (
          <span className="text-git-added">+{summary.additions}</span>
        ) : null}
        {summary.additions > 0 && summary.deletions > 0 ? " " : null}
        {summary.deletions > 0 ? (
          <span className="text-git-deleted">−{summary.deletions}</span>
        ) : null}
      </span>
    );
  }
  if (summary.count !== null && summary.phase === "done") {
    return (
      <span className="shrink-0 text-subtle-foreground tabular-nums">
        {summary.count === 1 ? "1 result" : `${summary.count} results`}
      </span>
    );
  }
  return null;
}

const ToolCallRow = memo(function ToolCallRow({
  toolCall,
  isStreaming,
}: {
  toolCall: ToolCall;
  isStreaming?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Keep the body mounted after its first reveal so collapsing can animate too.
  const [hasOpened, setHasOpened] = useState(false);
  const userToggled = useRef(false);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const summary = useMemo(
    () => summarizeToolCall(toolCall, { isStreaming, rootFolderPath }),
    [toolCall, isStreaming, rootFolderPath],
  );

  const output = stripStructuredToolViews(toolCall.output);
  const structuredViews = getStructuredToolViews(toolCall.output);
  const diffItems = getAcpDiffOutputs(output);
  const terminalItems = getAcpTerminalOutputs(output);
  const locationTree =
    toolCall.locations && toolCall.locations.length > 1
      ? createAcpToolLocationTree(toolCall.locations)
      : undefined;
  const outputText = getOutputText(stripAcpDiffOutputs(output));
  const showInput =
    summary.kind === "other" || summary.kind === "think" || summary.kind === "switch_mode";
  const inputText = showInput && toolCall.input ? formatValue(toolCall.input) : "";
  const errorText = toolCall.error && toolCall.error !== summary.error ? toolCall.error : "";

  const body: ReactNode[] = [];
  if (errorText) body.push(<OutputBlock key="error" text={errorText} tone="error" />);
  diffItems.forEach((item, index) =>
    body.push(
      <ExtensionViewRenderer
        key={`diff-${item.path}-${index}`}
        node={createAcpDiffViewNode(item, rootFolderPath)}
        execute={() => undefined}
        surface="embedded"
      />,
    ),
  );
  if (inputText) body.push(<OutputBlock key="input" text={inputText} />);
  if (outputText) body.push(<OutputBlock key="output" text={outputText} />);
  if (locationTree) {
    body.push(
      <ExtensionViewRenderer
        key="locations"
        node={locationTree}
        execute={(action) => {
          const path = action.args?.[0];
          if (action.command === OPEN_TOOL_LOCATION_COMMAND && typeof path === "string") {
            return openToolPath(path);
          }
        }}
        surface="embedded"
      />,
    );
  }
  structuredViews.forEach((view, index) =>
    body.push(<GenerativeUIRenderer key={`ui-${index}`} component={view} />),
  );

  const canExpand = body.length > 0;
  // A finished edit opens on its own; that diff is what the row is for.
  const autoExpand = summary.kind === "edit" && diffItems.length > 0;
  useEffect(() => {
    if (autoExpand && !userToggled.current) {
      setIsExpanded(true);
      setHasOpened(true);
    }
  }, [autoExpand]);
  const toggle = () => {
    userToggled.current = true;
    setHasOpened(true);
    setIsExpanded((current) => !current);
  };
  const isRunning = summary.phase === "running";
  const isFailed = summary.phase === "failed";
  const KindIcon = KIND_ICONS[summary.kind];
  const canOpenDiff =
    Boolean(summary.path) &&
    (summary.kind === "edit" ||
      summary.kind === "delete" ||
      summary.kind === "move" ||
      diffItems.length > 0);
  const canOpenFile = Boolean(summary.path) && summary.kind !== "execute";
  const canOpenTerminal = terminalItems.length > 0;
  const hasActions = canOpenDiff || canOpenFile || canOpenTerminal;

  const label = (
    <>
      <span className={cn(summary.kind === "other" && "font-mono")}>{summary.verb}</span>
      {summary.target ? (
        <>
          {" "}
          <span
            className={cn(
              "text-foreground",
              summary.kind === "execute" || summary.kind === "search" ? "font-mono" : "",
            )}
          >
            {summary.target}
          </span>
        </>
      ) : null}
    </>
  );

  return (
    <div data-ai-element="tool-call" className="group/tool flex min-w-0 flex-col">
      <div className="flex w-fit max-w-full min-w-0 items-center gap-1">
        {canExpand ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={toggle}
            className="flex min-h-6 min-w-0 flex-1 items-center gap-2 rounded text-left text-subtle-foreground outline-none ui-text-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ToolCallRowContent
              icon={KindIcon}
              isRunning={isRunning}
              isFailed={isFailed}
              label={label}
              summary={summary}
            />
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover/tool:opacity-40",
                isExpanded && "rotate-90 opacity-40",
              )}
            />
          </button>
        ) : (
          <div
            role={isRunning ? "status" : undefined}
            className="flex min-h-6 min-w-0 flex-1 items-center gap-2 text-subtle-foreground ui-text-sm"
          >
            <ToolCallRowContent
              icon={KindIcon}
              isRunning={isRunning}
              isFailed={isFailed}
              label={label}
              summary={summary}
            />
          </div>
        )}
        {hasActions ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/tool:opacity-100 focus-within:opacity-100">
            {canOpenDiff ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Open diff"
                onClick={() => void openToolDiff(summary.path!, toolCall.output)}
              >
                <GitDiffIcon />
              </Button>
            ) : null}
            {canOpenFile ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Open file"
                onClick={() => void openToolPath(summary.path!)}
              >
                <FileTextIcon />
              </Button>
            ) : null}
            {canOpenTerminal ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Open terminal"
                onClick={() => openAcpTerminalOutput(toolCall.output)}
              >
                <TerminalWindowIcon />
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {canExpand && hasOpened ? (
        <div
          aria-hidden={!isExpanded}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
            isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-1 mb-1.5 ml-6 flex min-w-0 flex-col gap-1.5">{body}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

function ToolCallRowContent({
  icon: KindIcon,
  isRunning,
  isFailed,
  label,
  summary,
}: {
  icon: Icon;
  isRunning: boolean;
  isFailed: boolean;
  label: ReactNode;
  summary: ToolCallSummary;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5",
          isRunning && "text-primary",
          isFailed && "text-destructive",
        )}
      >
        {isRunning ? (
          <CircleDottedIcon className="animate-spin" />
        ) : isFailed ? (
          <WarningCircleIcon />
        ) : (
          <KindIcon />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <Shimmer active={isRunning} className="min-w-0 truncate">
          {label}
        </Shimmer>
        <ToolCallStats summary={summary} />
      </span>
    </>
  );
}

export function ToolCallList({
  toolCalls,
  isStreaming,
  className,
}: {
  toolCalls: ToolCall[];
  isStreaming?: boolean;
  className?: string;
}) {
  if (toolCalls.length === 0) return null;

  return (
    <div
      data-ai-element="tool-calls"
      className={cn("flex min-w-0 flex-col select-none", className)}
    >
      {toolCalls.map((toolCall, index) => (
        <ToolCallRow
          key={toolCall.id || `${toolCall.name}-${index}`}
          toolCall={toolCall}
          isStreaming={isStreaming}
        />
      ))}
    </div>
  );
}
