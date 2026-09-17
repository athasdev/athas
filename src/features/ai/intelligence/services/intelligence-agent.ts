import { streamText, tool, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import type { AIMessage } from "@/features/ai/types/messages.types";
import type { AcpEvent, AcpToolKind } from "@/features/ai/types/acp.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { isMac, isWindows } from "@/utils/platform";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useIntelligenceSettingsStore } from "../stores/intelligence-settings.store";
import { getIntelligenceSdkModel } from "./intelligence-sdk-model";
import { toIntelligenceSdkPrompt } from "../lib/intelligence-sdk-prompt";
import { requestIntelligencePermission } from "./intelligence-agent-permissions";

import { beginIntelligenceAgent, finishIntelligenceAgent } from "./intelligence-agent-session";

export async function runIntelligenceAgent(params: {
  sessionId: string;
  providerId: string;
  modelId: string;
  messages: AIMessage[];
  root?: string;
  readOnly: boolean;
  onChunk: (text: string) => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolComplete?: (name: string, id?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
}) {
  const controller = beginIntelligenceAgent(params.sessionId);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]);
  const unsubscribeAuth = useAuthStore.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id) controller.abort();
  });
  const unsubscribeScope = useIntelligenceSettingsStore.subscribe((next, previous) => {
    if (next.scope !== previous.scope) controller.abort();
  });
  const readFiles = new Map<string, string>();
  const runTool = async <T>(
    name: string,
    kind: AcpToolKind,
    input: unknown,
    id: string,
    execute: () => Promise<T>,
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
      locations: [],
    });
    try {
      const output = await execute();
      if (kind !== "edit") signal.throwIfAborted();
      params.onToolComplete?.(name, id, output);
      return output;
    } catch (error) {
      params.onToolComplete?.(
        name,
        id,
        undefined,
        error instanceof Error ? error.message : "Tool failed",
      );
      throw error;
    }
  };
  try {
    const model = await getIntelligenceSdkModel(params.providerId, params.modelId);
    signal.throwIfAborted();
    const root = params.root && !/^[a-z]+:\/\//i.test(params.root) ? params.root : undefined;
    const tools = root
      ? {
          list_files: tool({
            description:
              "List up to 512 workspace files, excluding build directories and credentials.",
            inputSchema: z.object({}),
            execute: async (input, { toolCallId }) =>
              runTool("list_files", "search", input, toolCallId, () =>
                invoke<string[]>("intelligence_list_files", { root }),
              ),
          }),
          search_files: tool({
            description:
              "Search literal text in up to 512 workspace files. Returns at most 40 matches; results may be incomplete. Excludes build directories and credentials.",
            inputSchema: z.object({ query: z.string().min(1).max(500) }),
            execute: async (input, { toolCallId }) =>
              runTool("search_files", "search", input, toolCallId, () =>
                invoke("intelligence_search_files", { root, query: input.query }),
              ),
          }),
          read_file: tool({
            description:
              "Read a workspace text file. Paths are relative to the workspace. Read before editing.",
            inputSchema: z.object({
              path: z.string().min(1).max(1024),
              startLine: z.number().int().min(1).default(1),
            }),
            execute: async (input, { toolCallId }) =>
              runTool("read_file", "read", input, toolCallId, async () => {
                const content = await invoke<string>("intelligence_read_file", {
                  root,
                  path: input.path,
                });
                readFiles.set(input.path, content);
                const lines = content.split("\n");
                return {
                  path: input.path,
                  startLine: input.startLine,
                  totalLines: lines.length,
                  text: lines
                    .slice(input.startLine - 1, input.startLine + 199)
                    .join("\n")
                    .slice(0, 12000),
                };
              }),
          }),
          ...(!params.readOnly
            ? {
                run_command: tool({
                  description:
                    "Propose a shell command in the workspace directory. Requires user approval for every invocation. Runs with the user's permissions, not in a sandbox. Maximum 60 seconds; output is capped. Do not start background services.",
                  inputSchema: z.object({ command: z.string().min(1).max(8000) }),
                  execute: async (input, { toolCallId }) =>
                    runTool("run_command", "execute", input, toolCallId, async () => {
                      const approved = await requestIntelligencePermission({
                        sessionId: params.sessionId,
                        path: root,
                        kind: "command",
                        description: `Working directory: ${root}\n\nCommand:\n${input.command}\n\nRuns with your account permissions and can modify files or access the network.`,
                        signal,
                        notify: params.onPermissionRequest,
                      });
                      if (!approved)
                        return { executed: false, reason: "The user declined the command." };
                      signal.throwIfAborted();
                      const id = crypto.randomUUID();
                      const cancel = () => {
                        void invoke("intelligence_cancel_command", { id }).catch(() => {});
                      };
                      signal.addEventListener("abort", cancel, { once: true });
                      try {
                        return await invoke("intelligence_run_command", {
                          root,
                          command: input.command,
                          id,
                        });
                      } finally {
                        signal.removeEventListener("abort", cancel);
                        readFiles.clear();
                      }
                    }),
                }),
                edit_file: tool({
                  description:
                    "Propose replacing one exact text occurrence in a file already read, or create a new file with empty oldText. The user reviews and approves the edit before it is written.",
                  inputSchema: z.object({
                    path: z.string().min(1).max(1024),
                    oldText: z.string().max(12000),
                    newText: z.string().max(24000),
                    create: z.boolean().default(false),
                  }),
                  execute: async (input, { toolCallId }) =>
                    runTool("edit_file", "edit", input, toolCallId, async () => {
                      if (!input.create && !readFiles.has(input.path))
                        throw new Error("Read this file before editing it.");
                      const approved = await requestIntelligencePermission({
                        sessionId: params.sessionId,
                        path: input.path,
                        description: `${input.path}\n\nReplace:\n${input.oldText || "(new file)"}\n\nWith:\n${input.newText}`,
                        signal,
                        notify: params.onPermissionRequest,
                      });
                      if (!approved)
                        return { applied: false, reason: "The user declined the edit." };
                      signal.throwIfAborted();
                      const normalizePath = (path: string) => {
                        const normalized = path
                          .replace(/\\/g, "/")
                          .split("/")
                          .filter((part) => part !== ".")
                          .join("/");
                        return isMac() || isWindows() ? normalized.toLowerCase() : normalized;
                      };
                      const filePath = normalizePath(`${root.replace(/[/\\]$/, "")}/${input.path}`);
                      const bufferStates = [
                        useBufferStore.getState(),
                        ...workspaceRuntimeRegistry
                          .getExistingStores<ReturnType<typeof useBufferStore.getState>>(
                            "editor-buffer",
                          )
                          .map((store) => store.getState()),
                      ];
                      if (
                        bufferStates.some((state) =>
                          state.buffers.some(
                            (buffer) =>
                              buffer.path &&
                              normalizePath(buffer.path) === filePath &&
                              buffer.type === "editor" &&
                              buffer.isDirty,
                          ),
                        )
                      ) {
                        throw new Error(
                          "The editor has unsaved changes. Ask the user to save this file first.",
                        );
                      }
                      await invoke("intelligence_edit_file", {
                        root,
                        path: input.path,
                        expectedContent: input.create ? null : readFiles.get(input.path),
                        oldText: input.oldText,
                        newText: input.newText,
                      });
                      readFiles.delete(input.path);
                      return { applied: true, path: input.path };
                    }),
                }),
              }
            : {}),
        }
      : {};
    const messages: ModelMessage[] = params.messages.map((message) => {
      if (message.role === "user" && message.images?.length)
        return {
          role: "user",
          content: [
            { type: "text", text: message.content },
            ...message.images.map((image) => ({
              type: "image" as const,
              image: image.data,
              mediaType: image.mediaType,
            })),
          ],
        };
      return { role: message.role, content: message.content };
    });
    const result = streamText({
      model,
      ...toIntelligenceSdkPrompt(messages),
      tools,
      stopWhen: isStepCount(12),
      maxOutputTokens: 4096,
      maxRetries: 0,
      abortSignal: signal,
      onError: () => {},
    });
    let failure: unknown;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") params.onChunk(part.text);
      if (part.type === "error") failure = part.error;
    }
    if (failure && !signal.aborted) throw failure;
    if (!signal.aborted && (await result.finishReason) === "tool-calls") {
      params.onChunk(
        "\n\nPaused after 12 steps. Send a follow-up message to continue; completed changes are saved.",
      );
    }
    return { outcome: signal.aborted ? ("cancelled" as const) : ("completed" as const) };
  } catch (error) {
    if (signal.aborted) return { outcome: "cancelled" as const };
    throw error;
  } finally {
    controller.abort();
    unsubscribeAuth();
    unsubscribeScope();
    finishIntelligenceAgent(params.sessionId, controller);
  }
}
