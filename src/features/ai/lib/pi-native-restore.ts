import type { AcpRuntimeState } from "@/features/ai/types/acp";
import type { AgentType, AIChatSurface, Chat, Message } from "@/features/ai/types/ai-chat";
import type { HarnessRuntimeSessionInfo, HarnessRuntimeTranscriptMessage } from "./harness-runtime";
import type { HarnessRuntimeBackend } from "./harness-runtime-backend";

interface ShouldReconcilePiNativeSessionParams {
  surface: AIChatSurface;
  runtimeBackend: HarnessRuntimeBackend;
  agentId: AgentType;
  workspacePath: string | null;
  chat: Pick<Chat, "messages" | "acpState"> | null | undefined;
}

interface PiNativeSessionTitleSource {
  name: string | null;
  firstMessage: string;
}

interface ShouldReuseCurrentHarnessSessionForPiNativeResumeParams {
  sessionKey: string | null | undefined;
  chat: Pick<Chat, "messages" | "acpState"> | null | undefined;
}

const normalizeText = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, " ").trim() ?? "";

export const shouldReconcilePiNativeSession = ({
  surface,
  runtimeBackend,
  agentId,
  workspacePath,
  chat,
}: ShouldReconcilePiNativeSessionParams): boolean => {
  if (surface !== "harness" || runtimeBackend !== "pi-native" || agentId !== "pi") {
    return false;
  }

  if (!workspacePath || !chat || chat.messages.length > 0) {
    return false;
  }

  return !chat.acpState?.runtimeState?.sessionPath;
};

export const shouldReuseCurrentHarnessSessionForPiNativeResume = ({
  sessionKey,
  chat,
}: ShouldReuseCurrentHarnessSessionForPiNativeResumeParams): boolean => {
  if (!sessionKey || !chat) {
    return false;
  }

  if (chat.messages.length > 0) {
    return false;
  }

  return !chat.acpState?.runtimeState?.sessionPath;
};

export const derivePiNativeSessionTitle = ({
  name,
  firstMessage,
}: PiNativeSessionTitleSource): string => {
  const normalizedName = normalizeText(name);
  if (normalizedName) {
    return normalizedName;
  }

  const normalizedFirstMessage = normalizeText(firstMessage);
  if (!normalizedFirstMessage) {
    return "Harness";
  }

  return normalizedFirstMessage.length > 52
    ? `${normalizedFirstMessage.slice(0, 52)}...`
    : normalizedFirstMessage;
};

export const buildPiNativeRuntimeStateFromSession = (
  session: HarnessRuntimeSessionInfo,
): AcpRuntimeState => ({
  agentId: "pi",
  source: "pi-native",
  sessionId: session.id,
  sessionPath: session.path,
  workspacePath: session.cwd,
  provider: null,
  modelId: null,
  thinkingLevel: null,
  behavior: null,
});

export const buildPiNativeChatMessagesFromTranscript = (
  transcript: HarnessRuntimeTranscriptMessage[],
): Message[] =>
  transcript.map((message) => ({
    id: message.id,
    lineageMessageId: message.id,
    content: message.content,
    role: message.role,
    timestamp: new Date(message.timestamp),
    kind: "default",
  }));
