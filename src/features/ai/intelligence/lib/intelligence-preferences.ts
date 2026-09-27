import {
  intelligenceTasks,
  type IntelligenceConnection,
  type IntelligencePreferences,
} from "../types/intelligence.types";

export function defaultIntelligencePreferences(): IntelligencePreferences {
  return { defaultConnection: { providerId: "auto", modelId: "" }, tasks: {}, autoRouting: true };
}

function connection(value: unknown): IntelligenceConnection | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.providerId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(entry.providerId))
    return null;
  if (typeof entry.modelId !== "string" || entry.modelId.length > 200) return null;
  return { providerId: entry.providerId, modelId: entry.modelId.trim() };
}

export function parseIntelligencePreferences(value: unknown): IntelligencePreferences {
  if (!value || typeof value !== "object") return defaultIntelligencePreferences();
  const raw = value as Record<string, unknown>;
  const defaults = defaultIntelligencePreferences();
  const tasks: IntelligencePreferences["tasks"] = {};
  if (raw.tasks && typeof raw.tasks === "object") {
    for (const task of intelligenceTasks) {
      const parsed = connection((raw.tasks as Record<string, unknown>)[task]);
      if (parsed) tasks[task] = parsed;
    }
  }
  return {
    defaultConnection: connection(raw.defaultConnection) ?? defaults.defaultConnection,
    tasks,
    autoRouting: typeof raw.autoRouting === "boolean" ? raw.autoRouting : defaults.autoRouting,
  };
}
