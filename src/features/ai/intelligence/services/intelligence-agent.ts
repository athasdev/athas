import {
  streamText,
  tool,
  isStepCount,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";
import {
  commands,
  type IntelligenceCommandRun,
  type IntelligenceFileWrite,
} from "@/bindings/commands";
import type { AIMessage } from "@/features/ai/types/messages.types";
import type {
  AcpEvent,
  AcpPlanEntry,
  AcpToolCallLocation,
  AcpToolKind,
  AcpTurnUsage,
} from "@/features/ai/types/acp.types";
import {
  currentAgentTurnId,
  recordAgentFileDelete,
  recordAgentFileWrite,
} from "@/features/ai/services/agent-edits-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { isMac, isWindows } from "@/utils/platform";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useIntelligenceSettingsStore } from "../stores/intelligence-settings.store";
import { getIntelligenceSdkModel } from "./intelligence-sdk-model";
import { toIntelligenceSdkPrompt } from "../lib/intelligence-sdk-prompt";
import { requestIntelligencePermission } from "./intelligence-agent-permissions";
import {
  allowCommandPrefix,
  commandPathsStayInWorkspace,
  getCommandAutoApproval,
} from "./intelligence-command-allowlist";
import { getCommandAllowPrefix } from "../lib/intelligence-command-policy";
import { getExtraTools, type ExtraTools, type McpToolCallRequest } from "./intelligence-mcp";
import { allowMcpTool, isMcpToolAllowed } from "./intelligence-mcp-allowlist";
import { IntelligenceAgentError, toIntelligenceAgentError } from "../lib/intelligence-agent-error";
import {
  getOllamaNoToolsMessage,
  getOllamaReadOnlyNoToolsNotice,
  isOllamaNoToolsError,
} from "@/features/ai/lib/ollama-tool-support";
import { resolveOllamaToolSupport } from "./intelligence-ollama-tools";
import { normalizeIntelligenceAgentSteps } from "../lib/intelligence-agent-steps";
import {
  fitStepMessages,
  getStepRequestLimits,
  measureToolDefinitions,
  serializedBytes,
} from "../lib/intelligence-step-budget";
import type { IntelligenceAgentResult } from "../types/intelligence-agent.types";
import { parseExtensionViewNode } from "@/extensions/ui/services/extension-view-schema";

import { beginIntelligenceAgent, finishIntelligenceAgent } from "./intelligence-agent-session";

const READ_LINES = 250;
const READ_CHARS = 24000;
const MCP_INPUT_PREVIEW_CHARS = 4000;
const UNSAVED_CHANGES =
  "The editor has unsaved changes to this file. Ask the user to save or discard them first.";

function toTurnUsage(usage: LanguageModelUsage | undefined): AcpTurnUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  if (!totalTokens) return undefined;
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    thoughtTokens: usage.outputTokenDetails?.reasoningTokens ?? null,
    cachedReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
    cachedWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
  };
}

function normalizeBufferPath(path: string) {
  const normalized = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== ".")
    .join("/");
  return isMac() || isWindows() ? normalized.toLowerCase() : normalized;
}

/** Whether any open workspace has unsaved edits to `path`, which an agent write must not race. */
function hasUnsavedBuffer(path: string) {
  const target = normalizeBufferPath(path);
  const bufferStates = [
    useBufferStore.getState(),
    ...workspaceRuntimeRegistry
      .getExistingStores<ReturnType<typeof useBufferStore.getState>>("editor-buffer")
      .map((store) => store.getState()),
  ];
  return bufferStates.some((state) =>
    state.buffers.some(
      (buffer) =>
        buffer.path &&
        normalizeBufferPath(buffer.path) === target &&
        buffer.type === "editor" &&
        buffer.isDirty,
    ),
  );
}

export async function runIntelligenceAgent(params: {
  sessionId: string;
  providerId: string;
  modelId: string;
  messages: AIMessage[];
  root?: string;
  readOnly: boolean;
  /** Model requests this turn may make; defaults to `DEFAULT_INTELLIGENCE_AGENT_STEPS`. */
  maxSteps?: number;
  maxOutputTokens?: number;
  /**
   * Notes about how the request was prepared, such as images left out for a text-only model;
   * shown before the answer and returned with the result.
   */
  notices?: string[];
  onChunk: (text: string) => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolComplete?: (name: string, id?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  /** Receives a `plan_update` event whenever the agent rewrites its todo list. */
  onEvent?: (event: AcpEvent) => void;
}): Promise<IntelligenceAgentResult> {
  const controller = beginIntelligenceAgent(params.sessionId);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]);
  const unsubscribeAuth = useAuthStore.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id) controller.abort();
  });
  const unsubscribeScope = useIntelligenceSettingsStore.subscribe((next, previous) => {
    if (next.scope !== previous.scope) controller.abort();
  });
  const maxSteps = normalizeIntelligenceAgentSteps(params.maxSteps);
  let steps = 0;
  let costUsd: number | undefined;
  const notices: string[] = [];
  const summary = () => ({
    steps,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(notices.length ? { notices } : {}),
  });
  // Only the user's own stop is a quiet cancellation; the watchdog should say why.
  const settleAbort = (): IntelligenceAgentResult => {
    if (!controller.signal.aborted) throw new Error("The request timed out after 10 minutes.");
    return { outcome: "cancelled", stopReason: "cancelled", ...summary() };
  };
  // Writes belong to the turn that started this run, even ones that land after a stop.
  const turnId = currentAgentTurnId(params.sessionId);
  const readFiles = new Map<string, string>();
  const workspaceRoot = params.root?.replace(/[/\\]$/, "") ?? "";
  const absolutePath = (path: string) => `${workspaceRoot}/${path}`;
  // Writes run one at a time, so parallel tool calls never race on the same file.
  let writeQueue: Promise<unknown> = Promise.resolve();
  const serializeWrite = <T>(write: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(write, write);
    writeQueue = next.catch(() => undefined);
    return next;
  };
  const runTool = async <T>(
    name: string,
    kind: AcpToolKind,
    input: unknown,
    id: string,
    execute: () => Promise<T>,
    options: {
      locations?: AcpToolCallLocation[];
      /** What the transcript shows for this call; the model still receives the plain result. */
      display?: (result: T) => unknown;
    } = {},
  ) => {
    signal.throwIfAborted();
    params.onToolUse?.({
      type: "tool_start",
      sessionId: params.sessionId,
      toolName: name,
      toolId: id,
      input,
      kind,
      status: "in_progress",
      locations: options.locations ?? [],
    });
    try {
      const output = await execute();
      signal.throwIfAborted();
      params.onToolComplete?.(name, id, options.display ? options.display(output) : output);
      return output;
    } catch (error) {
      params.onToolComplete?.(
        name,
        id,
        undefined,
        signal.aborted ? "Stopped" : error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };
  /**
   * Finishes a write the way ACP agent writes finish: it is already on disk, and it goes into the
   * chat's review log so the user can keep or reject each hunk.
   */
  const landWrite = (write: IntelligenceFileWrite, relativePath: string) => {
    recordAgentFileWrite(params.sessionId, {
      writeId: write.writeId,
      path: write.path,
      previousContent: write.previousContent,
      content: write.content,
      ...(turnId ? { turnId } : {}),
    });
    // The agent knows what it wrote, so it can keep editing without reading again.
    readFiles.set(relativePath, write.content);
    return {
      created: write.previousContent === null,
      diff: {
        type: "diff" as const,
        path: write.path,
        oldText: write.previousContent ?? "",
        newText: write.content,
      },
    };
  };
  /**
   * Records the files a command changed like the agent's own writes, so they can be reviewed and
   * a checkpoint restore undoes them. What the model gets back names the files, not their text.
   */
  const landCommandChanges = (fileChanges: IntelligenceCommandRun["fileChanges"]) => {
    if (!fileChanges) return { fileChanges: "The workspace could not be checked for changes." };
    const relative = (path: string) =>
      path.startsWith(`${workspaceRoot}/`) ? path.slice(workspaceRoot.length + 1) : path;
    for (const change of fileChanges.changes) {
      if (change.content !== null) {
        recordAgentFileWrite(params.sessionId, {
          path: change.path,
          previousContent: change.previousContent,
          content: change.content,
          ...(turnId ? { turnId } : {}),
        });
      } else if (change.previousContent !== null) {
        recordAgentFileDelete(params.sessionId, {
          path: change.path,
          previousContent: change.previousContent,
          ...(turnId ? { turnId } : {}),
        });
      }
    }
    const notes = fileChanges.skipped.map(
      (skipped) => `${relative(skipped.path)} changed but is not in the review: ${skipped.reason}`,
    );
    if (fileChanges.incomplete)
      notes.push("Some changed files were not checked; the workspace or the change is too large.");
    return {
      ...(fileChanges.changes.length
        ? { changedFiles: fileChanges.changes.map((change) => relative(change.path)) }
        : {}),
      ...(notes.length ? { unreviewedChanges: notes } : {}),
    };
  };
  const authorizeMcpTool = async (call: McpToolCallRequest) => {
    if (isMcpToolAllowed(call.serverId, call.tool)) return true;
    const input = JSON.stringify(call.input ?? {}, null, 2) ?? "{}";
    const decision = await requestIntelligencePermission({
      sessionId: params.sessionId,
      path: call.serverName,
      kind: "mcp",
      description: `MCP server: ${call.serverName}\nTool: ${call.tool}\n\nInput:\n${input.slice(0, MCP_INPUT_PREVIEW_CHARS)}\n\nMCP tools run outside Athas and can change data or reach the network.`,
      allowAlwaysLabel: `Always allow ${call.tool}`,
      signal,
      notify: params.onPermissionRequest,
    });
    if (decision.always) allowMcpTool(call.serverId, call.tool);
    return decision.approved;
  };
  let extraTools: ExtraTools | undefined;
  try {
    const model = await getIntelligenceSdkModel(params.providerId, params.modelId, undefined, {
      onCost: (usd) => {
        costUsd = (costUsd ?? 0) + usd;
      },
    });
    signal.throwIfAborted();
    const root = params.root && !/^[a-z]+:\/\//i.test(params.root) ? params.root : undefined;
    extraTools = await getExtraTools(root, {
      signal,
      readOnly: params.readOnly,
      authorize: authorizeMcpTool,
      track: (name, input, toolCallId, execute) =>
        runTool(name, "other", input, toolCallId, execute),
    });
    signal.throwIfAborted();
    for (const notice of extraTools.notices) {
      notices.push(notice);
      params.onChunk(`_${notice}_\n\n`);
    }
    const builtInTools = root
      ? {
          list_files: tool({
            description:
              "List workspace files in path order, respecting .gitignore, root .athasignore/.aiignore/.cursorignore, and leaving out credentials. Returns one page: pass nextOffset back as offset for the next. Narrow with path (a folder) or glob (like *.ts or src/**/*.rs).",
            inputSchema: z.object({
              path: z.string().max(1024).optional(),
              glob: z.string().max(200).optional(),
              offset: z.number().int().min(0).optional(),
              limit: z.number().int().min(1).max(2000).optional(),
            }),
            execute: async (input, { toolCallId }) =>
              runTool("list_files", "search", input, toolCallId, () =>
                commands.intelligenceListFiles(root, {
                  path: input.path ?? null,
                  glob: input.glob ?? null,
                  offset: input.offset ?? null,
                  limit: input.limit ?? null,
                }),
              ),
          }),
          search_files: tool({
            description:
              "Search file contents across the whole workspace, like ripgrep: .gitignore and root .athasignore/.aiignore/.cursorignore are respected; credentials and binary files are skipped. Literal text by default; set regex for a regular expression. Case-insensitive unless the query has an uppercase letter or caseSensitive is set. Narrow with path or glob, and ask for contextLines around each match.",
            inputSchema: z.object({
              query: z.string().min(1).max(500),
              regex: z.boolean().optional(),
              caseSensitive: z.boolean().optional(),
              path: z.string().max(1024).optional(),
              glob: z.string().max(200).optional(),
              contextLines: z.number().int().min(0).max(5).optional(),
              maxResults: z.number().int().min(1).max(500).optional(),
            }),
            execute: async (input, { toolCallId }) =>
              runTool("search_files", "search", input, toolCallId, () =>
                commands.intelligenceSearchFiles(root, {
                  query: input.query,
                  regex: input.regex,
                  caseSensitive: input.caseSensitive ?? null,
                  path: input.path ?? null,
                  glob: input.glob ?? null,
                  contextLines: input.contextLines ?? null,
                  maxResults: input.maxResults ?? null,
                }),
              ),
          }),
          read_file: tool({
            description: `Read a workspace text file, ${READ_LINES} lines at a time from startLine. Paths are relative to the workspace. Read a file before editing, overwriting or deleting it.`,
            inputSchema: z.object({
              path: z.string().min(1).max(1024),
              startLine: z.number().int().min(1).default(1),
            }),
            execute: async (input, { toolCallId }) =>
              runTool(
                "read_file",
                "read",
                input,
                toolCallId,
                async () => {
                  const content = await commands.intelligenceReadFile(root, input.path);
                  readFiles.set(input.path, content);
                  const lines = content.split("\n");
                  return {
                    path: input.path,
                    startLine: input.startLine,
                    totalLines: lines.length,
                    text: lines
                      .slice(input.startLine - 1, input.startLine - 1 + READ_LINES)
                      .join("\n")
                      .slice(0, READ_CHARS),
                  };
                },
                { locations: [{ path: absolutePath(input.path), line: input.startLine }] },
              ),
          }),
          show_view: tool({
            description:
              "Show structured UI in the user's agent side panel instead of long prose: a comparison table, a checklist, a file tree, key metrics, a callout or a code block. Pass an Athas view node such as { type: 'table', columns: [{ key, label }], rows: [{ key: value }] }, { type: 'list', items: [{ title, description }] }, { type: 'metric', label, value }, { type: 'callout', tone: 'info' | 'warning', title, body }, { type: 'text', value } or { type: 'stack', children: [...] }. Keep it small and specific to what the user asked.",
            inputSchema: z.object({
              view: z.record(z.string(), z.unknown()),
            }),
            execute: async (input, { toolCallId }) => {
              const view = parseExtensionViewNode(input.view);
              return runTool(
                "show_view",
                "other",
                input,
                toolCallId,
                async () => ({ shown: true }),
                { display: () => ({ type: "athas_ui", view }) },
              );
            },
          }),
          todo_write: tool({
            description:
              "Keep a checklist for multi-step work. Send the whole list every time, with at most one item in_progress; the user sees it update live. Skip it for one-step requests.",
            inputSchema: z.object({
              todos: z
                .array(
                  z.object({
                    content: z.string().min(1).max(500),
                    status: z.enum(["pending", "in_progress", "completed"]),
                    priority: z.enum(["high", "medium", "low"]).default("medium"),
                  }),
                )
                .max(50),
            }),
            execute: async (input, { toolCallId }) =>
              runTool("todo_write", "think", input, toolCallId, async () => {
                const entries: AcpPlanEntry[] = input.todos;
                params.onEvent?.({ type: "plan_update", sessionId: params.sessionId, entries });
                return {
                  updated: true,
                  completed: entries.filter((entry) => entry.status === "completed").length,
                  total: entries.length,
                };
              }),
          }),
          ...(!params.readOnly
            ? {
                run_command: tool({
                  description:
                    "Run a shell command in the workspace directory. Read-only commands and ones the user always allowed run at once; others wait for approval. Runs with the user's permissions, not in a sandbox. Maximum 60 seconds; output is capped. Files the command changes go into the same review as your edits. Do not start background services.",
                  inputSchema: z.object({ command: z.string().min(1).max(8000) }),
                  execute: async (input, { toolCallId }) =>
                    runTool("run_command", "execute", input, toolCallId, async () => {
                      const autoApproved =
                        getCommandAutoApproval(root, input.command) !== null &&
                        (await commandPathsStayInWorkspace(root, input.command));
                      signal.throwIfAborted();
                      if (!autoApproved) {
                        const prefix = getCommandAllowPrefix(input.command);
                        const always = prefix
                          ? `\n\nAlways allow runs commands starting with \`${prefix}\` in this workspace without asking.`
                          : "";
                        const decision = await requestIntelligencePermission({
                          sessionId: params.sessionId,
                          path: root,
                          kind: "command",
                          description: `Working directory: ${root}\n\nCommand:\n${input.command}\n\nRuns with your account permissions and can modify files or access the network.${always}`,
                          preview: { type: "command", command: input.command, cwd: root },
                          allowAlwaysLabel: prefix ? `Always allow ${prefix}` : undefined,
                          signal,
                          notify: params.onPermissionRequest,
                        });
                        if (!decision.approved)
                          return { executed: false, reason: "The user declined the command." };
                        if (decision.always) allowCommandPrefix(root, input.command);
                      }
                      signal.throwIfAborted();
                      const id = crypto.randomUUID();
                      const cancel = () => {
                        void commands.intelligenceCancelCommand(id).catch(() => {});
                      };
                      signal.addEventListener("abort", cancel, { once: true });
                      try {
                        const { fileChanges, ...output } = await commands.intelligenceRunCommand(
                          root,
                          input.command,
                          id,
                        );
                        return {
                          ...output,
                          ...landCommandChanges(fileChanges),
                        };
                      } finally {
                        signal.removeEventListener("abort", cancel);
                        readFiles.clear();
                      }
                    }),
                }),
                edit_file: tool({
                  description:
                    "Edit a file you have read by replacing exact text. Send every change to one file in a single call as edits; they apply in order, all or none. Each oldText must match exactly one location (include surrounding lines to make it unique) unless replaceAll is set. The change lands at once and the user can keep or reject it afterwards.",
                  inputSchema: z.object({
                    path: z.string().min(1).max(1024),
                    edits: z
                      .array(
                        z.object({
                          oldText: z.string().min(1).max(24000),
                          newText: z.string().max(48000),
                          replaceAll: z.boolean().optional(),
                        }),
                      )
                      .min(1)
                      .max(64),
                  }),
                  execute: async (input, { toolCallId }) => {
                    await runTool(
                      "edit_file",
                      "edit",
                      input,
                      toolCallId,
                      () =>
                        serializeWrite(async () => {
                          const expectedContent = readFiles.get(input.path);
                          if (expectedContent === undefined)
                            throw new Error("Read this file before editing it.");
                          if (hasUnsavedBuffer(absolutePath(input.path)))
                            throw new Error(UNSAVED_CHANGES);
                          signal.throwIfAborted();
                          const write = await commands.intelligenceEditFile(
                            root,
                            input.path,
                            expectedContent,
                            input.edits,
                          );
                          return landWrite(write, input.path);
                        }),
                      {
                        locations: [{ path: absolutePath(input.path) }],
                        display: (result) => [result.diff],
                      },
                    );
                    return { applied: true, path: input.path };
                  },
                }),
                write_file: tool({
                  description:
                    "Create a file, or replace all of a file you have read. Prefer edit_file for changes to existing files. Missing folders are created. The change lands at once and the user can keep or reject it afterwards.",
                  inputSchema: z.object({
                    path: z.string().min(1).max(1024),
                    content: z.string().max(256 * 1024),
                  }),
                  execute: async (input, { toolCallId }) => {
                    const result = await runTool(
                      "write_file",
                      "edit",
                      { path: input.path },
                      toolCallId,
                      () =>
                        serializeWrite(async () => {
                          if (hasUnsavedBuffer(absolutePath(input.path)))
                            throw new Error(UNSAVED_CHANGES);
                          signal.throwIfAborted();
                          const write = await commands.intelligenceWriteFile(
                            root,
                            input.path,
                            readFiles.get(input.path) ?? null,
                            input.content,
                          );
                          return landWrite(write, input.path);
                        }),
                      {
                        locations: [{ path: absolutePath(input.path) }],
                        display: (result) => [result.diff],
                      },
                    );
                    return { written: true, created: result.created, path: input.path };
                  },
                }),
                delete_file: tool({
                  description:
                    "Delete a file you have read. The user approves every deletion; it cannot be rejected from the review afterwards, only undone by restoring the turn's checkpoint.",
                  inputSchema: z.object({ path: z.string().min(1).max(1024) }),
                  execute: async (input, { toolCallId }) =>
                    runTool(
                      "delete_file",
                      "delete",
                      input,
                      toolCallId,
                      () =>
                        serializeWrite(async () => {
                          const expectedContent = readFiles.get(input.path);
                          if (expectedContent === undefined)
                            throw new Error("Read this file before deleting it.");
                          if (hasUnsavedBuffer(absolutePath(input.path)))
                            throw new Error(UNSAVED_CHANGES);
                          const decision = await requestIntelligencePermission({
                            sessionId: params.sessionId,
                            path: input.path,
                            kind: "delete",
                            description: `Delete ${input.path}?`,
                            preview: {
                              type: "diff",
                              path: absolutePath(input.path),
                              oldText: expectedContent,
                              newText: "",
                            },
                            signal,
                            notify: params.onPermissionRequest,
                          });
                          if (!decision.approved)
                            return { deleted: false, reason: "The user declined the deletion." };
                          signal.throwIfAborted();
                          await commands.intelligenceDeleteFile(root, input.path, expectedContent);
                          // Checkpoint restore can bring the file back.
                          recordAgentFileDelete(params.sessionId, {
                            // Written like the paths Rust reports for writes: no `.` segments.
                            path: absolutePath(
                              input.path
                                .split(/[\\/]/)
                                .filter((part) => part && part !== ".")
                                .join("/"),
                            ),
                            previousContent: expectedContent,
                            ...(turnId ? { turnId } : {}),
                          });
                          readFiles.delete(input.path);
                          return { deleted: true, path: input.path };
                        }),
                      { locations: [{ path: absolutePath(input.path) }] },
                    ),
                }),
              }
            : {}),
        }
      : {};
    let tools: ToolSet = { ...extraTools.tools, ...builtInTools };
    // Ollama rejects tools for models that cannot call them. Say so up front in Agent mode rather
    // than letting the model claim edits it never made; Ask and Plan answer without the workspace.
    if (params.providerId === "ollama" && Object.keys(tools).length > 0) {
      const support = await resolveOllamaToolSupport(params.modelId);
      signal.throwIfAborted();
      if (support === "unsupported") {
        if (!params.readOnly)
          throw new IntelligenceAgentError(getOllamaNoToolsMessage(params.modelId));
        const notice = getOllamaReadOnlyNoToolsNotice(params.modelId);
        notices.push(notice);
        params.onChunk(`_${notice}_\n\n`);
        tools = {};
      }
    }
    for (const notice of params.notices ?? []) {
      notices.push(notice);
      params.onChunk(`_${notice}_\n\n`);
    }
    const messages: ModelMessage[] = params.messages.map((message) => {
      if (message.role === "user" && message.images?.length)
        return {
          role: "user",
          content: [
            { type: "text", text: message.content },
            // OpenAI-compatible providers, Athas included, send these as `image_url` data URLs.
            ...message.images.map((image) => ({
              type: "file" as const,
              data: image.data,
              mediaType: image.mediaType,
            })),
          ],
        };
      return { role: message.role, content: message.content };
    });
    const prompt = toIntelligenceSdkPrompt(messages);
    const stepLimits = getStepRequestLimits(params.providerId);
    const toolBytes = await measureToolDefinitions(tools);
    signal.throwIfAborted();
    const result = streamText({
      model,
      ...prompt,
      tools,
      stopWhen: isStepCount(maxSteps),
      // Every step resends all earlier tool results, so older ones are trimmed before a request
      // would outgrow what the provider accepts.
      prepareStep: ({ messages: stepMessages, instructions }) => {
        const fitted = fitStepMessages(stepMessages, stepLimits, {
          firstStep: prompt.messages.length,
          instructionBytes: serializedBytes(instructions) + toolBytes,
        });
        return fitted ? { messages: fitted } : undefined;
      },
      maxOutputTokens: params.maxOutputTokens ?? 4096,
      // Retries happen in the model's fetch, per request, where Retry-After is visible and the
      // idempotency key stays the same.
      maxRetries: 0,
      abortSignal: signal,
      onError: () => {},
    });
    let failure: unknown;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") params.onChunk(part.text);
      if (part.type === "finish-step") steps++;
      if (part.type === "error") failure = part.error;
    }
    if (signal.aborted) return settleAbort();
    if (failure) throw toIntelligenceAgentError(failure);
    const usage = toTurnUsage(await result.totalUsage);
    const finishReason = await result.finishReason;
    return {
      outcome: "completed",
      // A turn that still wanted tools ran out of steps; the chat offers Continue for both.
      stopReason:
        finishReason === "tool-calls"
          ? "max_turn_requests"
          : finishReason === "length"
            ? "max_tokens"
            : "end_turn",
      ...(usage ? { usage } : {}),
      ...summary(),
    };
  } catch (error) {
    if (signal.aborted) return settleAbort();
    if (params.providerId === "ollama" && isOllamaNoToolsError(error))
      throw new IntelligenceAgentError(getOllamaNoToolsMessage(params.modelId));
    throw toIntelligenceAgentError(error);
  } finally {
    controller.abort();
    await extraTools?.close().catch(() => undefined);
    unsubscribeAuth();
    unsubscribeScope();
    finishIntelligenceAgent(params.sessionId, controller);
  }
}
