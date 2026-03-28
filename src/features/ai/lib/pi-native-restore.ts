import { createForkedChatLineage } from "@/features/ai/lib/chat-lineage";
import type { ChatLineageState } from "@/features/ai/store/types";
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

interface ShouldEnsurePiNativeRestoreChatParams {
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

interface FindOpenHarnessPiNativeSessionKeyParams {
  sessionPath: string;
  sessions: Array<{
    sessionKey: string | null | undefined;
    chat: Pick<Chat, "acpState"> | null | undefined;
  }>;
}

interface FindPiNativeParentChatParams {
  session: Pick<HarnessRuntimeSessionInfo, "parentSessionPath">;
  chats: Array<
    Pick<Chat, "id" | "title" | "rootChatId" | "lineageDepth" | "sessionName" | "acpState">
  >;
}

const normalizeText = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, " ").trim() ?? "";

const derivePiNativeRuntimeMetadataFromTranscript = (
  transcript: HarnessRuntimeTranscriptMessage[] = [],
) =>
  transcript.reduce(
    (metadata, entry) => {
      if (entry.provider && entry.modelId) {
        metadata.provider = entry.provider;
        metadata.modelId = entry.modelId;
      }

      if (entry.thinkingLevel) {
        metadata.thinkingLevel = entry.thinkingLevel;
      }

      return metadata;
    },
    {
      provider: null as string | null,
      modelId: null as string | null,
      thinkingLevel: null as string | null,
    },
  );

export const shouldEnsurePiNativeRestoreChat = ({
  surface,
  runtimeBackend,
  agentId,
  workspacePath,
  chat,
}: ShouldEnsurePiNativeRestoreChatParams): boolean => {
  if (surface !== "harness" || runtimeBackend !== "pi-native" || agentId !== "pi") {
    return false;
  }

  if (!workspacePath) {
    return false;
  }

  return !chat;
};

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

export const findOpenHarnessPiNativeSessionKey = ({
  sessionPath,
  sessions,
}: FindOpenHarnessPiNativeSessionKeyParams): string | null => {
  for (const session of sessions) {
    const candidateSessionKey = normalizeText(session.sessionKey);
    const runtimeState = session.chat?.acpState?.runtimeState;
    if (
      candidateSessionKey &&
      runtimeState?.source === "pi-native" &&
      runtimeState.sessionPath === sessionPath
    ) {
      return candidateSessionKey;
    }
  }

  return null;
};

export const findPiNativeParentChatForSession = ({
  session,
  chats,
}: FindPiNativeParentChatParams): Pick<
  Chat,
  "id" | "title" | "rootChatId" | "lineageDepth" | "sessionName"
> | null => {
  const parentSessionPath = normalizeText(session.parentSessionPath);
  if (!parentSessionPath) {
    return null;
  }

  for (const chat of chats) {
    const runtimeState = chat.acpState?.runtimeState;
    if (runtimeState?.source === "pi-native" && runtimeState.sessionPath === parentSessionPath) {
      return chat;
    }
  }

  return null;
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

export const buildPiNativeSessionLineage = ({
  sessionTitle,
  parentChat,
}: {
  sessionTitle: string;
  parentChat: Pick<Chat, "id" | "title" | "rootChatId" | "lineageDepth" | "sessionName"> | null;
}): ChatLineageState | null => {
  if (!parentChat) {
    return null;
  }

  return {
    ...createForkedChatLineage(parentChat, null),
    sessionName: sessionTitle,
  };
};

export const buildPiNativeRuntimeStateFromSession = (
  session: HarnessRuntimeSessionInfo,
  transcript: HarnessRuntimeTranscriptMessage[] = [],
): AcpRuntimeState => ({
  ...derivePiNativeRuntimeMetadataFromTranscript(transcript),
  agentId: "pi",
  source: "pi-native",
  sessionId: session.id,
  sessionPath: session.path,
  workspacePath: session.cwd,
  behavior: null,
});

export const buildPiNativeChatMessagesFromTranscript = (
  transcript: HarnessRuntimeTranscriptMessage[],
): Message[] =>
  transcript.flatMap((message) => {
    if (message.entryType !== "message" || !message.role || !message.content) {
      return [];
    }

    return [
      {
        id: message.id,
        lineageMessageId: message.id,
        content: message.content,
        role: message.role,
        timestamp: new Date(message.timestamp),
        kind: "default" as const,
      },
    ];
  });
