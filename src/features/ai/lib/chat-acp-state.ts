import type { AcpRuntimeState, SessionMode, SlashCommand } from "@/features/ai/types/acp";
import type { Chat, ChatAcpState } from "@/features/ai/types/ai-chat";

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const cloneSessionMode = (mode: SessionMode): SessionMode => ({
  ...mode,
});

const cloneSlashCommand = (command: SlashCommand): SlashCommand => ({
  ...command,
  input: command.input ? { ...command.input } : command.input,
});

const normalizeRuntimeState = (state: AcpRuntimeState): AcpRuntimeState => {
  const normalizedState: AcpRuntimeState = {
    ...state,
    source: normalizeOptionalString(state.source),
    sessionId: normalizeOptionalString(state.sessionId),
    sessionPath: normalizeOptionalString(state.sessionPath),
    workspacePath: normalizeOptionalString(state.workspacePath),
    provider: normalizeOptionalString(state.provider),
    modelId: normalizeOptionalString(state.modelId),
    thinkingLevel: normalizeOptionalString(state.thinkingLevel),
    behavior: normalizeOptionalString(state.behavior),
  };

  if (
    normalizedState.agentId === "pi" &&
    normalizedState.source === "pi-local" &&
    normalizedState.sessionId?.startsWith("pi:") &&
    !normalizedState.sessionPath
  ) {
    normalizedState.sessionId = null;
  }

  return normalizedState;
};

const cloneRuntimeState = (state: AcpRuntimeState): AcpRuntimeState => normalizeRuntimeState(state);

const createForkedRuntimeState = (
  runtimeState: AcpRuntimeState | null | undefined,
): AcpRuntimeState | null => {
  if (!runtimeState) {
    return null;
  }

  const clonedRuntimeState = cloneRuntimeState(runtimeState);
  if (
    clonedRuntimeState.agentId === "pi" &&
    clonedRuntimeState.source === "pi-native" &&
    (clonedRuntimeState.sessionId || clonedRuntimeState.sessionPath)
  ) {
    return {
      ...clonedRuntimeState,
      sessionId: null,
      sessionPath: null,
    };
  }

  return clonedRuntimeState;
};

export const normalizeChatAcpState = (state?: ChatAcpState | null): ChatAcpState => ({
  preferredModeId: normalizeOptionalString(state?.preferredModeId),
  currentModeId:
    normalizeOptionalString(state?.currentModeId) ??
    normalizeOptionalString(state?.preferredModeId),
  availableModes: (state?.availableModes ?? []).map(cloneSessionMode),
  slashCommands: (state?.slashCommands ?? []).map(cloneSlashCommand),
  runtimeState: state?.runtimeState ? cloneRuntimeState(state.runtimeState) : null,
});

export const cloneChatAcpState = (state?: ChatAcpState | null): ChatAcpState | null =>
  state ? normalizeChatAcpState(state) : null;

export const createForkedChatAcpState = (
  sourceChat: Pick<Chat, "acpState">,
): ChatAcpState | null => {
  const clonedState = cloneChatAcpState(sourceChat.acpState);
  if (!clonedState) {
    return null;
  }

  return {
    ...clonedState,
    runtimeState: createForkedRuntimeState(clonedState.runtimeState),
  };
};

export const getChatPreferredAcpModeId = (
  chat: Pick<Chat, "acpState"> | null | undefined,
  defaultModeId: string | null,
): string | null => {
  const preferredModeId = normalizeOptionalString(chat?.acpState?.preferredModeId);
  if (preferredModeId) {
    return preferredModeId;
  }

  return normalizeOptionalString(defaultModeId);
};

export const getChatWarmStartAcpState = (
  chat: Pick<Chat, "acpState"> | null | undefined,
): ChatAcpState => normalizeChatAcpState(chat?.acpState);

export const withCachedSlashCommands = (
  state: ChatAcpState | null | undefined,
  commands: SlashCommand[],
): ChatAcpState => ({
  ...normalizeChatAcpState(state),
  slashCommands: commands.map(cloneSlashCommand),
});

export const withRuntimeState = (
  state: ChatAcpState | null | undefined,
  runtimeState: AcpRuntimeState | null,
): ChatAcpState => ({
  ...normalizeChatAcpState(state),
  runtimeState: runtimeState ? cloneRuntimeState(runtimeState) : null,
});

export const withCachedSessionModeState = (
  state: ChatAcpState | null | undefined,
  currentModeId: string | null,
  availableModes: SessionMode[],
): ChatAcpState => {
  const normalizedState = normalizeChatAcpState(state);
  const nextCurrentModeId = currentModeId ?? normalizedState.currentModeId ?? null;

  return {
    ...normalizedState,
    preferredModeId: nextCurrentModeId ?? normalizedState.preferredModeId,
    currentModeId: nextCurrentModeId,
    availableModes: availableModes.map(cloneSessionMode),
  };
};

export const withPreferredAcpModeId = (
  state: ChatAcpState | null | undefined,
  modeId: string | null,
): ChatAcpState => {
  const normalizedState = normalizeChatAcpState(state);

  return {
    ...normalizedState,
    preferredModeId: modeId,
    currentModeId: modeId ?? normalizedState.currentModeId,
  };
};
