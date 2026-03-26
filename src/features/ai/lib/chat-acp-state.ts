import type { AcpRuntimeState, SessionMode, SlashCommand } from "@/features/ai/types/acp";
import type { Chat, ChatAcpState } from "@/features/ai/types/ai-chat";

const cloneSessionMode = (mode: SessionMode): SessionMode => ({
  ...mode,
});

const cloneSlashCommand = (command: SlashCommand): SlashCommand => ({
  ...command,
  input: command.input ? { ...command.input } : command.input,
});

const cloneRuntimeState = (state: AcpRuntimeState): AcpRuntimeState => ({
  ...state,
});

export const normalizeChatAcpState = (state?: ChatAcpState | null): ChatAcpState => ({
  preferredModeId: state?.preferredModeId ?? null,
  currentModeId: state?.currentModeId ?? state?.preferredModeId ?? null,
  availableModes: (state?.availableModes ?? []).map(cloneSessionMode),
  slashCommands: (state?.slashCommands ?? []).map(cloneSlashCommand),
  runtimeState: state?.runtimeState ? cloneRuntimeState(state.runtimeState) : null,
});

export const cloneChatAcpState = (state?: ChatAcpState | null): ChatAcpState | null =>
  state ? normalizeChatAcpState(state) : null;

export const createForkedChatAcpState = (sourceChat: Pick<Chat, "acpState">): ChatAcpState | null =>
  cloneChatAcpState(sourceChat.acpState);

export const getChatPreferredAcpModeId = (
  chat: Pick<Chat, "acpState"> | null | undefined,
  defaultModeId: string | null,
): string | null => {
  const preferredModeId = chat?.acpState?.preferredModeId?.trim();
  if (preferredModeId) {
    return preferredModeId;
  }

  const normalizedDefaultModeId = defaultModeId?.trim();
  return normalizedDefaultModeId || null;
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
