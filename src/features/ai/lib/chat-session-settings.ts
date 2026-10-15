import type { AcpSessionState, SessionConfigValue } from "@/features/ai/types/acp.types";
import type {
  ChatCloudEnvironment,
  ChatCloudRun,
  ChatSessionSettings,
} from "@/features/ai/types/ai-chat.types";

function parseCloudRun(value: unknown): ChatCloudRun[] {
  if (!value || typeof value !== "object") return [];
  const { messageId, runId, error } = value as Record<string, unknown>;
  if (typeof messageId !== "string") return [];
  const run: ChatCloudRun = { messageId, runId: typeof runId === "string" ? runId : null };
  if (error && typeof error === "object") {
    const { message, code } = error as Record<string, unknown>;
    if (typeof message === "string")
      run.error = typeof code === "string" ? { message, code } : { message };
  }
  return [run];
}

function parseCloudEnvironment(value: unknown): ChatCloudEnvironment | null {
  if (!value || typeof value !== "object") return null;
  const { repo, branch, runs } = value as Record<string, unknown>;
  return {
    repo: typeof repo === "string" && repo ? repo : null,
    branch: typeof branch === "string" && branch ? branch : null,
    runs: Array.isArray(runs) ? runs.flatMap(parseCloudRun) : [],
  };
}

/** Reads a chat's saved session settings; anything unreadable counts as none. */
export function parseChatSessionSettings(
  value: string | null | undefined,
): ChatSessionSettings | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { modeId, configOptions, followAgent, cloud } = parsed as Record<string, unknown>;
    const settings: ChatSessionSettings = {};
    if (typeof modeId === "string") settings.modeId = modeId;
    if (typeof followAgent === "boolean") settings.followAgent = followAgent;
    const cloudEnvironment = parseCloudEnvironment(cloud);
    if (cloudEnvironment) settings.cloud = cloudEnvironment;
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
