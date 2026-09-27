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
import { useShallow } from "zustand/react/shallow";
import {
  createAcpDiffViewNode,
  getAcpDiffOutputs,
  type AcpDiffOutput,
  openAcpDiffOutput,
  stripAcpDiffOutputs,
} from "@/features/ai/lib/acp-diff-output";
import {
  getStructuredToolViews,
  isStructuredToolViewEnvelope,
  stripStructuredToolViews,
} from "@/features/ai/lib/structured-tool-view";
import {
  describeAcpTerminalExit,
  formatAcpTerminalText,
  getAcpTerminalOutputs,
  openAcpTerminalOutput,
} from "@/features/ai/lib/acp-terminal-output";
import { useAcpTerminalsStore } from "@/features/ai/stores/acp-terminals.store";
import { summarizeToolCall, type ToolCallSummary } from "@/features/ai/lib/tool-call-summary";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AcpTerminalSnapshot, AcpToolKind } from "@/features/ai/types/acp.types";
import {
  describeExploration,
  groupToolCalls,
  type ToolCallListItem,
} from "@/features/ai/lib/tool-call-groups";
import { openToolPath } from "@/features/ai/lib/open-tool-location";
import { ToolLocations } from "./tool-locations";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { CodeOutput } from "@/ui/code-output";
import { Shimmer } from "@/ui/shimmer";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import { ExtensionViewRenderer } from "@/extensions/ui/components/extension-view-renderer";
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

/** Rows a diff shows inside the transcript before the user asks for the rest. */
const DIFF_PREVIEW_ROWS = 16;

function ToolDiff({
  diff,
  rootFolderPath,
}: {
  diff: AcpDiffOutput;
  rootFolderPath?: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const node = useMemo(() => createAcpDiffViewNode(diff, rootFolderPath), [diff, rootFolderPath]);
  const hiddenRows = showAll ? 0 : Math.max(0, node.lines.length - DIFF_PREVIEW_ROWS);
  const preview = useMemo(
    () => (hiddenRows > 0 ? { ...node, lines: node.lines.slice(0, DIFF_PREVIEW_ROWS) } : node),
    [node, hiddenRows],
  );

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <ExtensionViewRenderer node={preview} execute={() => undefined} surface="embedded" />
      {hiddenRows > 0 ? (
        <Button type="button" variant="link" onClick={() => setShowAll(true)}>
          Expand diff ({hiddenRows} more {hiddenRows === 1 ? "line" : "lines"})
        </Button>
      ) : null}
    </div>
  );
}

/** A terminal's output inside its tool call, with how the command ended once it has. */
function TerminalOutput({ terminal }: { terminal: AcpTerminalSnapshot }) {
  const text = useMemo(() => formatAcpTerminalText(terminal.output).trimEnd(), [terminal.output]);
  const status = describeAcpTerminalExit(terminal.exit);
  const failed =
    terminal.exit !== null && (terminal.exit.signal !== null || terminal.exit.exitCode !== 0);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {text ? (
        <CodeOutput tone="muted">{terminal.truncated ? `…\n${text}` : text}</CodeOutput>
      ) : null}
      {status ? (
        <span className={cn("ui-text-sm", failed ? "text-destructive" : "text-subtle-foreground")}>
          {status}
        </span>
      ) : null}
    </div>
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
  if (summary.phase === "declined" || summary.phase === "cancelled") {
    return <span className="shrink-0 text-subtle-foreground">{summary.phase}</span>;
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
  isLatestEdit = false,
}: {
  toolCall: ToolCall;
  isStreaming?: boolean;
  /** The newest edit of the latest reply opens on its own; earlier ones fold away. */
  isLatestEdit?: boolean;
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
  const diffItems = useMemo(() => getAcpDiffOutputs(output), [output]);
  const terminalItems = getAcpTerminalOutputs(output);
  const liveTerminals = useAcpTerminalsStore(
    useShallow((state) => terminalItems.map((item) => state.terminals[item.terminalId])),
  );
  const outputText = getOutputText(stripAcpDiffOutputs(output));
  const showInput =
    summary.kind === "other" || summary.kind === "think" || summary.kind === "switch_mode";
  const inputText = showInput && toolCall.input ? formatValue(toolCall.input) : "";
  const errorText = toolCall.error && toolCall.error !== summary.error ? toolCall.error : "";

  const body: ReactNode[] = [];
  if (errorText) {
    body.push(
      <CodeOutput key="error" tone="error">
        {errorText}
      </CodeOutput>,
    );
  }
  diffItems.forEach((item, index) =>
    body.push(
      <ToolDiff key={`diff-${item.path}-${index}`} diff={item} rootFolderPath={rootFolderPath} />,
    ),
  );
  if (inputText) {
    body.push(
      <CodeOutput key="input" tone="muted">
        {inputText}
      </CodeOutput>,
    );
  }
  if (outputText) {
    body.push(
      <CodeOutput key="output" tone="muted">
        {outputText}
      </CodeOutput>,
    );
  }
  terminalItems.forEach(({ terminalId }, index) => {
    // Live while the command runs; what the call kept once the terminal is gone.
    const terminal = liveTerminals[index] ?? toolCall.terminals?.[terminalId];
    if (terminal && (terminal.output || terminal.exit)) {
      body.push(<TerminalOutput key={`terminal-${terminalId}`} terminal={terminal} />);
    }
  });
  if (toolCall.locations?.some((location) => location.path)) {
    body.push(
      <ToolLocations
        key="locations"
        locations={toolCall.locations}
        rootFolderPath={rootFolderPath}
      />,
    );
  }
  structuredViews.forEach((view, index) =>
    body.push(<GenerativeUIRenderer key={`ui-${index}`} component={view} />),
  );

  const canExpand = body.length > 0;
  // The latest finished edit opens on its own and folds once a newer one lands, unless the user
  // already chose.
  const autoExpand = isLatestEdit && diffItems.length > 0;
  useEffect(() => {
    if (userToggled.current) return;
    setIsExpanded(autoExpand);
    if (autoExpand) setHasOpened(true);
  }, [autoExpand]);
  const toggle = () => {
    userToggled.current = true;
    setHasOpened(true);
    setIsExpanded((current) => !current);
  };
  const isRunning = summary.phase === "running";
  const isFailed = summary.phase === "failed";
  const KindIcon = KIND_ICONS[summary.kind];
  // Only the change this call recorded; a diff against HEAD would mix in every other edit.
  const canOpenDiff = diffItems.length > 0;
  const canOpenFile = Boolean(summary.path) && summary.kind !== "execute";
  // Only a terminal Athas runs for the agent, and only while it still runs, has a tab to open.
  const canOpenTerminal = liveTerminals.some(
    (terminal) => terminal && !terminal.displayOnly && !terminal.exit,
  );
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
                "size-3.5 shrink-0 opacity-40 transition-[opacity,transform] group-hover/tool:opacity-100",
                isExpanded && "rotate-90",
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
          <span className="flex shrink-0 items-center opacity-40 transition-opacity group-hover/tool:opacity-100 focus-within:opacity-100">
            {canOpenDiff ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Open diff"
                onClick={() => openAcpDiffOutput(output)}
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

function ExplorationGroup({
  item,
  isStreaming,
  latestEdit,
}: {
  item: Extract<ToolCallListItem, { type: "exploration" }>;
  isStreaming?: boolean;
  latestEdit?: ToolCall | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div data-ai-element="tool-call-group" className="group/tool flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
        className="flex min-h-6 w-fit max-w-full min-w-0 items-center gap-2 rounded text-left text-subtle-foreground outline-none ui-text-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5",
            item.isRunning && "text-primary",
          )}
        >
          {item.isRunning ? <CircleDottedIcon className="animate-spin" /> : <SearchIcon />}
        </span>
        <Shimmer active={item.isRunning} className="min-w-0 truncate">
          {describeExploration(item)}
        </Shimmer>
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 opacity-40 transition-[opacity,transform] group-hover/tool:opacity-100",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      {isExpanded ? (
        <div className="ml-6 flex min-w-0 flex-col">
          {item.toolCalls.map((toolCall, index) => (
            <ToolCallRow
              key={toolCall.id || `${toolCall.name}-${index}`}
              toolCall={toolCall}
              isStreaming={isStreaming}
              isLatestEdit={toolCall === latestEdit}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ToolCallList({
  toolCalls,
  isStreaming,
  latestEdit,
  className,
}: {
  toolCalls: ToolCall[];
  isStreaming?: boolean;
  /** The call whose diff opens on its own, usually the newest edit of the latest reply. */
  latestEdit?: ToolCall | null;
  className?: string;
}) {
  const items = useMemo(() => groupToolCalls(toolCalls, isStreaming), [toolCalls, isStreaming]);
  if (items.length === 0) return null;

  return (
    <div
      data-ai-element="tool-calls"
      className={cn("flex min-w-0 flex-col select-none", className)}
    >
      {items.map((item) =>
        item.type === "exploration" ? (
          <ExplorationGroup
            key={item.key}
            item={item}
            isStreaming={isStreaming}
            latestEdit={latestEdit}
          />
        ) : (
          <ToolCallRow
            key={item.key}
            toolCall={item.toolCall}
            isStreaming={isStreaming}
            isLatestEdit={item.toolCall === latestEdit}
          />
        ),
      )}
    </div>
  );
}
