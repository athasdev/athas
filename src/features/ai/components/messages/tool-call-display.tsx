import {
  ArrowsLeftRightIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleDottedIcon,
  FileTextIcon,
  GitDiffIcon,
  GlobeIcon,
  ListChecksIcon,
  PencilLineIcon,
  SearchIcon,
  SlidersIcon,
  TerminalIcon,
  TerminalWindowIcon,
  TrashIcon,
  WrenchIcon,
  type Icon,
} from "@/ui/icons";
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useAgentEditEntries } from "@/features/ai/stores/agent-edits.store";
import { openAgentEditsReview } from "@/features/ai/services/agent-edits-service";
import { summarizeToolCall, type ToolCallSummary } from "@/features/ai/lib/tool-call-summary";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AcpTerminalSnapshot, AcpToolKind } from "@/features/ai/types/acp.types";
import {
  buildToolActivity,
  describeToolActivity,
  toolCallDurationMs,
  type ToolActivityItem,
} from "@/features/ai/lib/tool-call-groups";
import { formatElapsed } from "@/features/ai/lib/elapsed-time";
import { useElapsedSeconds } from "@/features/ai/hooks/use-elapsed-seconds";
import { openToolPath } from "@/features/ai/lib/open-tool-location";
import { DiffStats } from "../diff-stats";
import { ToolLocations } from "./tool-locations";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { CodeOutput } from "@/ui/code-output";
import { ICON_CONCEPTS } from "@/ui/icon-concepts";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { Shimmer } from "@/ui/shimmer";
import { GenerativeUIRenderer } from "@/extensions/ui/components/generative-ui-renderer";
import { ExtensionDiffPreview } from "@/extensions/ui/components/extension-diff-preview";
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

const FailedIcon = ICON_CONCEPTS["status.error"];

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
  caption,
}: {
  diff: AcpDiffOutput;
  rootFolderPath?: string | null;
  /** Names the file above its lines; the tool row already does when the call edits one file. */
  caption: boolean;
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
      <ExtensionDiffPreview
        filePath={preview.filePath}
        oldPath={preview.oldPath}
        language={preview.language}
        lines={preview.lines}
        truncated={preview.truncated}
        caption={caption}
      />
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

/** Whole seconds, shown only once a step took long enough for the number to mean something. */
function formatDuration(ms: number | null): string | null {
  if (ms === null || ms < 1000) return null;
  return formatElapsed(Math.round(ms / 1000));
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

/**
 * Open state for a disclosure that can also open on its own (a failed step, the latest edit)
 * until the user picks a state themselves. The body stays mounted after its first reveal so
 * collapsing animates too.
 */
function useDisclosure(autoExpand: boolean) {
  const [isExpanded, setIsExpanded] = useState(autoExpand);
  const [hasOpened, setHasOpened] = useState(autoExpand);
  const userToggled = useRef(false);
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
  return { isExpanded, hasOpened, toggle };
}

function DisclosureChevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-fast motion-reduce:transition-none",
        isExpanded && "rotate-90",
      )}
    />
  );
}

function DisclosureBody({
  id,
  isExpanded,
  hasOpened,
  children,
}: {
  id: string;
  isExpanded: boolean;
  hasOpened: boolean;
  children: ReactNode;
}) {
  if (!hasOpened) return null;
  return (
    <div
      id={id}
      aria-hidden={!isExpanded}
      inert={!isExpanded}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** The status column: a spinner while running, the error mark on failure, else the kind. */
function StepIcon({ icon: KindIcon, phase }: { icon: Icon; phase: ToolCallSummary["phase"] }) {
  return (
    <MarkerIcon tone={phase === "running" ? "accent" : phase === "failed" ? "error" : "default"}>
      {phase === "running" ? (
        <CircleDottedIcon className="motion-safe:animate-spin" />
      ) : phase === "failed" ? (
        <FailedIcon />
      ) : (
        <KindIcon />
      )}
    </MarkerIcon>
  );
}

function StepStatus({ summary, duration }: { summary: ToolCallSummary; duration: string | null }) {
  const status =
    summary.phase === "failed" ? (
      <span className="shrink-0 text-destructive">Failed</span>
    ) : summary.phase === "declined" || summary.phase === "cancelled" ? (
      <span className="shrink-0 capitalize">{summary.phase}</span>
    ) : summary.additions > 0 || summary.deletions > 0 ? (
      <DiffStats additions={summary.additions} deletions={summary.deletions} />
    ) : summary.count !== null && summary.phase === "done" ? (
      <span className="shrink-0 tabular-nums">
        {summary.count === 1 ? "1 result" : `${summary.count} results`}
      </span>
    ) : null;

  return (
    <>
      {status}
      {duration ? <span className="shrink-0 tabular-nums">{duration}</span> : null}
    </>
  );
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
  const bodyId = useId();
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
  const isThought = summary.kind === "think";
  const outputText = getOutputText(stripAcpDiffOutputs(output));
  const showInput = summary.kind === "other" || summary.kind === "switch_mode";
  const inputText = showInput && toolCall.input ? formatValue(toolCall.input) : "";

  const body: ReactNode[] = [];
  if (toolCall.error) {
    body.push(
      <CodeOutput key="error" tone="error">
        {toolCall.error}
      </CodeOutput>,
    );
  }
  diffItems.forEach((item, index) =>
    body.push(
      <ToolDiff
        key={`diff-${item.path}-${index}`}
        diff={item}
        rootFolderPath={rootFolderPath}
        caption={diffItems.length > 1}
      />,
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
      isThought ? (
        <p
          key="thought"
          className="whitespace-pre-wrap text-muted-foreground select-text leading-relaxed"
        >
          {outputText}
        </p>
      ) : (
        <CodeOutput key="output" tone="muted">
          {outputText}
        </CodeOutput>
      ),
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
  const isFailed = summary.phase === "failed";
  // A failure shows what went wrong, and the latest finished edit shows its diff, until the
  // user chooses otherwise.
  const { isExpanded, hasOpened, toggle } = useDisclosure(
    canExpand && (isFailed || (isLatestEdit && diffItems.length > 0)),
  );
  const isRunning = summary.phase === "running";
  // Only the change this call recorded; a diff against HEAD would mix in every other edit.
  const canOpenDiff = diffItems.length > 0;
  const canOpenFile = Boolean(summary.path) && summary.kind !== "execute";
  // Only a terminal Athas runs for the agent, and only while it still runs, has a tab to open.
  const canOpenTerminal = liveTerminals.some(
    (terminal) => terminal && !terminal.displayOnly && !terminal.exit,
  );
  const target = isThought ? firstLine(outputText) || null : summary.target;
  const duration = isRunning ? null : formatDuration(toolCallDurationMs(toolCall));

  const content = (
    <>
      <StepIcon icon={KIND_ICONS[summary.kind]} phase={summary.phase} />
      <MarkerContent className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate">
            <Shimmer active={isRunning}>
              <span
                className={cn("text-muted-foreground", summary.kind === "other" && "font-mono")}
              >
                {isThought ? "Thought" : summary.verb}
              </span>
              {target ? (
                <>
                  {" "}
                  <span
                    className={cn(
                      isThought ? "text-subtle-foreground" : "text-foreground",
                      (summary.kind === "execute" || summary.kind === "search") && "font-mono",
                    )}
                  >
                    {target}
                  </span>
                </>
              ) : null}
            </Shimmer>
          </span>
          <StepStatus summary={summary} duration={duration} />
        </span>
      </MarkerContent>
      {canExpand ? <DisclosureChevron isExpanded={isExpanded} /> : null}
    </>
  );

  return (
    <div
      data-ai-element="tool-call"
      data-phase={summary.phase}
      className="group/tool flex min-w-0 flex-col"
    >
      <div className="flex min-w-0 items-center gap-1">
        <Marker
          render={
            canExpand ? (
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={hasOpened ? bodyId : undefined}
                onClick={toggle}
              />
            ) : undefined
          }
          role={!canExpand && isRunning ? "status" : undefined}
          className="min-h-6 w-fit max-w-full min-w-0"
        >
          {content}
        </Marker>
        {canOpenDiff || canOpenFile || canOpenTerminal ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-fast group-hover/tool:opacity-100 focus-within:opacity-100">
            {canOpenDiff ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                iconOnly
                tooltip="Open diff"
                aria-label="Open diff"
                onClick={() => openAcpDiffOutput(output)}
              >
                <GitDiffIcon />
              </Button>
            ) : null}
            {canOpenFile ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                iconOnly
                tooltip="Open file"
                aria-label="Open file"
                onClick={() => void openToolPath(summary.path!)}
              >
                <FileTextIcon />
              </Button>
            ) : null}
            {canOpenTerminal ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                iconOnly
                tooltip="Open terminal"
                aria-label="Open terminal"
                onClick={() => openAcpTerminalOutput(toolCall.output)}
              >
                <TerminalWindowIcon />
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {canExpand ? (
        <DisclosureBody id={bodyId} isExpanded={isExpanded} hasOpened={hasOpened}>
          <div className="mt-1 mb-2 ml-6 flex min-w-0 flex-col gap-1.5">{body}</div>
        </DisclosureBody>
      ) : null}
    </div>
  );
});

/** A thought on its own: "Thought for 3s", with the reasoning behind a disclosure. */
function ThoughtRow({ toolCall }: { toolCall: ToolCall }) {
  const bodyId = useId();
  const { isExpanded, hasOpened, toggle } = useDisclosure(false);
  const text = getOutputText(toolCall.output);
  const duration = formatDuration(toolCallDurationMs(toolCall));
  const label = duration ? `Thought for ${duration}` : "Thought";

  if (!text) {
    return (
      <Marker data-ai-element="thought" className="min-h-6">
        <MarkerIcon>
          <BrainIcon />
        </MarkerIcon>
        <MarkerContent>{label}</MarkerContent>
      </Marker>
    );
  }

  return (
    <div data-ai-element="thought" className="flex min-w-0 flex-col">
      <Marker
        render={
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={hasOpened ? bodyId : undefined}
            onClick={toggle}
          />
        }
        className="min-h-6 w-fit max-w-full"
      >
        <MarkerIcon>
          <BrainIcon />
        </MarkerIcon>
        <MarkerContent>{label}</MarkerContent>
        <DisclosureChevron isExpanded={isExpanded} />
      </Marker>
      <DisclosureBody id={bodyId} isExpanded={isExpanded} hasOpened={hasOpened}>
        <p className="mt-1 mb-2 ml-6 whitespace-pre-wrap text-muted-foreground select-text leading-relaxed">
          {text}
        </p>
      </DisclosureBody>
    </div>
  );
}

/**
 * Two or more steps as one line: "Worked for 12s · Read 4 files, edited 2 files", or the step
 * in progress while the agent works. A failed step or the latest edit opens the list.
 */
function ToolActivityGroup({
  item,
  isStreaming,
  latestEdit,
  chatId,
}: {
  item: Extract<ToolActivityItem, { type: "group" }>;
  isStreaming?: boolean;
  latestEdit?: ToolCall | null;
  chatId?: string | null;
}) {
  const bodyId = useId();
  const { summary, toolCalls } = item;
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const isRunning = summary.running !== null;
  const hasFailed = summary.failed > 0;
  const containsLatestEdit = Boolean(latestEdit && toolCalls.includes(latestEdit));
  const { isExpanded, hasOpened, toggle } = useDisclosure(hasFailed || containsLatestEdit);
  const elapsed = useElapsedSeconds(summary.startedAt, isRunning);
  const hasUnreviewedEdits = Object.keys(useAgentEditEntries(chatId)).length > 0;
  const canReview =
    Boolean(chatId) && hasUnreviewedEdits && summary.additions + summary.deletions > 0;

  const running = summary.running
    ? summarizeToolCall(summary.running, { isStreaming, rootFolderPath })
    : null;
  const duration = formatDuration(summary.durationMs);
  const title = isRunning
    ? `Working${elapsed > 0 ? ` ${formatElapsed(elapsed)}` : ""}`
    : duration
      ? `Worked for ${duration}`
      : null;
  const detail = running
    ? [running.verb, running.target].filter(Boolean).join(" ")
    : describeToolActivity(summary);

  return (
    <div data-ai-element="tool-call-group" className="group/tool flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-1">
        <Marker
          render={
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={hasOpened ? bodyId : undefined}
              onClick={toggle}
            />
          }
          role={isRunning ? "status" : undefined}
          className="min-h-6 w-fit max-w-full min-w-0"
        >
          <MarkerIcon tone={hasFailed ? "error" : isRunning ? "accent" : "default"}>
            {isRunning ? (
              <CircleDottedIcon className="motion-safe:animate-spin" />
            ) : hasFailed ? (
              <FailedIcon />
            ) : (
              <ListChecksIcon />
            )}
          </MarkerIcon>
          <MarkerContent className="min-w-0">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate">
                {title ? (
                  <>
                    <span className="text-muted-foreground tabular-nums">{title}</span>
                    <span aria-hidden="true"> · </span>
                  </>
                ) : null}
                <Shimmer active={isRunning}>{detail}</Shimmer>
              </span>
              {hasFailed ? (
                <span className="shrink-0 text-destructive">{summary.failed} failed</span>
              ) : null}
              <DiffStats additions={summary.additions} deletions={summary.deletions} />
            </span>
          </MarkerContent>
          <DisclosureChevron isExpanded={isExpanded} />
        </Marker>
        {canReview ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-fast group-hover/tool:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              tooltip="Review the chat's unreviewed changes"
              onClick={() => openAgentEditsReview(chatId!)}
            >
              <GitDiffIcon />
              Review
            </Button>
          </span>
        ) : null}
      </div>
      <DisclosureBody id={bodyId} isExpanded={isExpanded} hasOpened={hasOpened}>
        <div className="mb-1 ml-6 flex min-w-0 flex-col">
          {toolCalls.map((toolCall, index) => (
            <ToolCallRow
              key={toolCall.id || `${toolCall.name}-${index}`}
              toolCall={toolCall}
              isStreaming={isStreaming}
              isLatestEdit={toolCall === latestEdit}
            />
          ))}
        </div>
      </DisclosureBody>
    </div>
  );
}

export function ToolCallList({
  toolCalls,
  isStreaming,
  latestEdit,
  chatId,
  className,
}: {
  toolCalls: ToolCall[];
  isStreaming?: boolean;
  /** The call whose diff opens on its own, usually the newest edit of the latest reply. */
  latestEdit?: ToolCall | null;
  /** The chat whose unreviewed edits the "Review" action opens. */
  chatId?: string | null;
  className?: string;
}) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const items = useMemo(
    () => buildToolActivity(toolCalls, { isStreaming, rootFolderPath }),
    [toolCalls, isStreaming, rootFolderPath],
  );
  if (items.length === 0) return null;

  return (
    <div
      data-ai-element="tool-calls"
      className={cn("flex min-w-0 flex-col select-none", className)}
    >
      {items.map((item) =>
        item.type === "group" ? (
          <ToolActivityGroup
            key={item.key}
            item={item}
            isStreaming={isStreaming}
            latestEdit={latestEdit}
            chatId={chatId}
          />
        ) : item.type === "thought" ? (
          <ThoughtRow key={item.key} toolCall={item.toolCall} />
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
