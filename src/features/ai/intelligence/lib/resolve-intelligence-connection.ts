import type {
  IntelligenceConnection,
  IntelligencePreferences,
  IntelligenceTask,
} from "../types/intelligence.types";

export function resolveIntelligenceConnection(params: {
  task: IntelligenceTask;
  preferences: IntelligencePreferences;
  hasIntelligence: boolean;
  personalConnection: IntelligenceConnection;
}): IntelligenceConnection {
  const connection = params.preferences.tasks[params.task] ?? params.preferences.defaultConnection;
  if (connection.providerId !== "auto") return connection;
  if (params.hasIntelligence) return { providerId: "athas", modelId: "auto" };
  return params.personalConnection;
}
