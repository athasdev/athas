import type { AcpSessionState, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { ChatSessionSettings } from "@/features/ai/types/ai-chat.types";

/** Reads a chat's saved session settings; anything unreadable counts as none. */
export function parseChatSessionSettings(
  value: string | null | undefined,
): ChatSessionSettings | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { modeId, configOptions } = parsed as Record<string, unknown>;
    const settings: ChatSessionSettings = {};
    if (typeof modeId === "string") settings.modeId = modeId;
    if (configOptions && typeof configOptions === "object") {
      settings.configOptions = Object.fromEntries(
        Object.entries(configOptions).filter(
          (entry): entry is [string, string | boolean] =>
            typeof entry[1] === "string" || typeof entry[1] === "boolean",
        ),
      );
    }
    return settings;
  } catch {
    return null;
  }
}

/** `settings` with the user's latest pick recorded. */
export function withSessionSetting(
  settings: ChatSessionSettings | null | undefined,
  pick: { modeId: string } | { configId: string; value: SessionConfigValue },
): ChatSessionSettings {
  if ("modeId" in pick) return { ...settings, modeId: pick.modeId };
  return {
    ...settings,
    configOptions: { ...settings?.configOptions, [pick.configId]: pick.value },
  };
}

/** The saved mode to switch a reattached session to: only one it still offers and is not in. */
export function getModeToRestore(
  settings: ChatSessionSettings | null | undefined,
  modeState: AcpSessionState["modeState"],
): string | null {
  const modeId = settings?.modeId;
  if (!modeId || modeState.currentModeId === modeId) return null;
  return modeState.availableModes.some((mode) => mode.id === modeId) ? modeId : null;
}

/** The saved config values a reattached session still offers and does not already have. */
export function getConfigOptionsToRestore(
  settings: ChatSessionSettings | null | undefined,
  options: AcpSessionState["configOptions"],
): Array<{ configId: string; value: SessionConfigValue }> {
  const saved = settings?.configOptions;
  if (!saved) return [];
  return options.flatMap((option): Array<{ configId: string; value: SessionConfigValue }> => {
    const value = saved[option.id];
    if (value === undefined || value === option.kind.currentValue) return [];
    if (option.kind.type === "boolean") {
      return typeof value === "boolean" ? [{ configId: option.id, value }] : [];
    }
    return typeof value === "string" && option.kind.options.some((item) => item.id === value)
      ? [{ configId: option.id, value }]
      : [];
  });
}
