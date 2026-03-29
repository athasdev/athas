import type {
  AcpAgentStatus,
  AcpEvent,
  AcpRuntimeState,
  SessionModeState,
  SlashCommand,
} from "@/features/ai/types/acp";
import type { AgentType, AIChatSurface, ChatScopeId } from "@/features/ai/types/ai-chat";
import type { AIMessage } from "@/features/ai/types/messages";
import type { Buffer } from "@/features/tabs/types/buffer";
import { AcpStreamHandler } from "@/utils/acp-handler";
import {
  type PiNativeModelInfo,
  type PiNativeSessionInfo,
  type PiNativeSessionSnapshot,
  PiNativeStreamHandler,
  type PiNativeTranscriptMessage,
} from "@/utils/pi-native-handler";
import type { ContextInfo } from "@/utils/types";
import {
  DEFAULT_HARNESS_RUNTIME_BACKEND,
  type HarnessRuntimeBackend,
} from "./harness-runtime-backend";

const HARNESS_SCOPE_PREFIX = "harness:";
const PI_NATIVE_NOT_WIRED_ERROR = "Pi native runtime is not wired into Athas yet.";

type HarnessRuntimeBuffer = Pick<Buffer, "isAgent" | "agentSessionId" | "agentBackend">;

interface HarnessRuntimeHandlers {
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
  resumeKey?: string;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onNewMessage?: () => void;
  onToolUse?: (toolName: string, toolInput?: unknown, toolId?: string) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (event: Extract<AcpEvent, { type: "permission_request" }>) => void;
  onEvent?: (event: AcpEvent) => void;
  onImageChunk?: (data: string, mediaType: string) => void;
  onResourceChunk?: (uri: string, name: string | null) => void;
}

interface HarnessRuntimePromptSession {
  start: (
    userMessage: string,
    context: ContextInfo,
    conversationHistory?: AIMessage[],
  ) => Promise<void>;
}

interface HarnessRuntimePromptSessionOptions {
  backend: HarnessRuntimeBackend;
  agentId: AgentType;
  handlers: HarnessRuntimeHandlers;
}

export interface HarnessRuntimeSessionInfo extends PiNativeSessionInfo {}
export interface HarnessRuntimeTranscriptMessage extends PiNativeTranscriptMessage {}
export interface HarnessRuntimeModelInfo extends PiNativeModelInfo {}
export interface HarnessRuntimeSessionSnapshot extends PiNativeSessionSnapshot {}

const getHarnessSessionKeyFromScopeId = (scopeId: ChatScopeId): string | null =>
  scopeId.startsWith(HARNESS_SCOPE_PREFIX) ? scopeId.slice(HARNESS_SCOPE_PREFIX.length) : null;

const buildPiNativeNotWiredError = (): Error => new Error(PI_NATIVE_NOT_WIRED_ERROR);

const findHarnessBufferForScope = (
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
): HarnessRuntimeBuffer | null => {
  const sessionKey = getHarnessSessionKeyFromScopeId(scopeId);
  if (!sessionKey) {
    return null;
  }

  return buffers.find((buffer) => buffer.isAgent && buffer.agentSessionId === sessionKey) ?? null;
};

const doesBufferMatchHarnessScope = (
  buffer: HarnessRuntimeBuffer | null | undefined,
  scopeId: ChatScopeId,
): boolean => {
  const sessionKey = getHarnessSessionKeyFromScopeId(scopeId);
  return Boolean(buffer?.isAgent && sessionKey && buffer.agentSessionId === sessionKey);
};

export const resolveHarnessRuntimeBackendForScope = (
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): HarnessRuntimeBackend => {
  if (!scopeId.startsWith(HARNESS_SCOPE_PREFIX)) {
    return DEFAULT_HARNESS_RUNTIME_BACKEND;
  }

  const matchingActiveBuffer = doesBufferMatchHarnessScope(activeBuffer, scopeId)
    ? activeBuffer
    : null;
  if (matchingActiveBuffer) {
    return matchingActiveBuffer.agentBackend ?? DEFAULT_HARNESS_RUNTIME_BACKEND;
  }

  return (
    findHarnessBufferForScope(scopeId, buffers)?.agentBackend ?? DEFAULT_HARNESS_RUNTIME_BACKEND
  );
};

export const createHarnessRuntimePromptSession = ({
  backend,
  agentId,
  handlers,
}: HarnessRuntimePromptSessionOptions): HarnessRuntimePromptSession => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      return {
        start: async () => {
          throw buildPiNativeNotWiredError();
        },
      };
    }

    return new PiNativeStreamHandler(handlers);
  }

  return new AcpStreamHandler(agentId, handlers);
};

export const getHarnessRuntimeStatus = async (
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<AcpAgentStatus> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    return PiNativeStreamHandler.getStatus(scopeId);
  }

  return AcpStreamHandler.getStatus(scopeId);
};

export const listHarnessRuntimeSessions = async (
  backend: HarnessRuntimeBackend,
  agentId: AgentType,
  workspacePath: string | null,
): Promise<HarnessRuntimeSessionInfo[]> => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      throw buildPiNativeNotWiredError();
    }

    return PiNativeStreamHandler.listSessions(workspacePath);
  }

  return [];
};

export const listHarnessRuntimeSlashCommands = async (
  backend: HarnessRuntimeBackend,
  agentId: AgentType,
  scopeId: ChatScopeId,
): Promise<SlashCommand[]> => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      throw buildPiNativeNotWiredError();
    }

    return PiNativeStreamHandler.listCommands(scopeId);
  }

  return [];
};

export const listHarnessRuntimeModels = async (
  backend: HarnessRuntimeBackend,
  agentId: AgentType,
  scopeId: ChatScopeId,
): Promise<HarnessRuntimeModelInfo[]> => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      throw buildPiNativeNotWiredError();
    }

    return PiNativeStreamHandler.listModels(scopeId);
  }

  return [];
};

export const listHarnessRuntimeThinkingLevels = async (
  backend: HarnessRuntimeBackend,
  agentId: AgentType,
  scopeId: ChatScopeId,
): Promise<string[]> => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      throw buildPiNativeNotWiredError();
    }

    return PiNativeStreamHandler.listThinkingLevels(scopeId);
  }

  return [];
};

export const getHarnessRuntimeSessionSnapshot = async (
  backend: HarnessRuntimeBackend,
  agentId: AgentType,
  scopeId: ChatScopeId,
): Promise<HarnessRuntimeSessionSnapshot | null> => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      throw buildPiNativeNotWiredError();
    }

    return PiNativeStreamHandler.getSessionSnapshot(scopeId);
  }

  return null;
};

export const getHarnessRuntimeSessionTranscript = async (
  backend: HarnessRuntimeBackend,
  agentId: AgentType,
  sessionPath: string,
): Promise<HarnessRuntimeTranscriptMessage[]> => {
  if (backend === "pi-native") {
    if (agentId !== "pi") {
      throw buildPiNativeNotWiredError();
    }

    return PiNativeStreamHandler.getSessionTranscript(sessionPath);
  }

  return [];
};

export const stopHarnessRuntime = async (
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<void> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    await PiNativeStreamHandler.stopSession(scopeId);
    return;
  }

  await AcpStreamHandler.stopAgent(scopeId);
};

export const cancelHarnessRuntimePrompt = async (
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<void> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    await PiNativeStreamHandler.cancelPrompt(scopeId);
    return;
  }

  await AcpStreamHandler.cancelPrompt(scopeId);
};

export const respondToHarnessPermission = async (
  requestId: string,
  approved: boolean,
  cancelled: boolean,
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  value?: string | null,
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<void> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    await PiNativeStreamHandler.respondToPermission(requestId, approved, cancelled, value, scopeId);
    return;
  }

  await AcpStreamHandler.respondToPermission(requestId, approved, cancelled, scopeId, value);
};

export const changeHarnessRuntimeSessionMode = async (
  modeId: string,
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<SessionModeState | null> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    return PiNativeStreamHandler.changeSessionMode(modeId, scopeId);
  }

  await AcpStreamHandler.changeSessionMode(modeId, scopeId);
  return null;
};

export const setHarnessRuntimeModel = async (
  selection: Pick<HarnessRuntimeModelInfo, "provider" | "modelId">,
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<AcpRuntimeState | null> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    return PiNativeStreamHandler.setModel(selection, scopeId);
  }

  throw new Error("Runtime model changes are only supported for Pi Native.");
};

export const setHarnessRuntimeThinkingLevel = async (
  level: string,
  scopeId: ChatScopeId,
  buffers: HarnessRuntimeBuffer[],
  activeBuffer?: HarnessRuntimeBuffer | null,
): Promise<AcpRuntimeState | null> => {
  const backend = resolveHarnessRuntimeBackendForScope(scopeId, buffers, activeBuffer);
  if (backend === "pi-native") {
    return PiNativeStreamHandler.setThinkingLevel(level, scopeId);
  }

  throw new Error("Runtime thinking changes are only supported for Pi Native.");
};
