import type {
  IntelligenceConnection,
  IntelligencePreferences,
  IntelligenceTask,
} from "../types/intelligence.types";

interface ConnectionContext {
  preferences: IntelligencePreferences;
  hasIntelligence: boolean;
  personalConnection: IntelligenceConnection;
  /**
   * Whether the personal connection runs on this machine or the local network. "Auto" then keeps
   * every task on it instead of routing prompts and code to hosted Athas.
   */
  personalConnectionIsLocal?: boolean;
}

const ATHAS_AUTOMATIC: IntelligenceConnection = { providerId: "athas", modelId: "auto" };

function withAthasModel(connection: IntelligenceConnection): IntelligenceConnection {
  return connection.providerId === "athas" && !connection.modelId.trim()
    ? ATHAS_AUTOMATIC
    : connection;
}

/**
 * The connection a task runs on: its own choice, or the default model. Tab completion does not
 * follow the default and resolves through `resolveAutocompleteConnection` instead.
 */
export function resolveIntelligenceConnection(
  params: ConnectionContext & { task: Exclude<IntelligenceTask, "autocomplete"> },
): IntelligenceConnection {
  const connection = withAthasModel(
    params.preferences.tasks[params.task] ?? params.preferences.defaultConnection,
  );
  if (connection.providerId !== "auto") return connection;
  if (params.personalConnectionIsLocal) return params.personalConnection;
  if (params.hasIntelligence) return ATHAS_AUTOMATIC;
  return params.personalConnection;
}

/**
 * Tab completion's connection. An explicit choice always wins. On Automatic it uses Athas's Tab
 * model when the account has access, unless the default model runs locally: then Tab uses that
 * local model, so code typed in the editor never leaves the machine. Without Athas access it falls
 * back to the default model the user already set up with their own key. Null when there is
 * nothing to run on, and Tab stays off until the user picks a model.
 */
export function resolveAutocompleteConnection(
  params: ConnectionContext & {
    /** Whether a provider runs locally, for a default model other than the personal one. */
    isLocalProvider?: (providerId: string) => boolean;
  },
): IntelligenceConnection | null {
  const choice = params.preferences.tasks.autocomplete;
  if (choice && choice.providerId !== "auto") return withAthasModel(choice);

  // The default model itself, not the "New chats" override, decides whether Tab stays local.
  const chatDefault = resolveIntelligenceConnection({
    ...params,
    preferences: { ...params.preferences, tasks: {} },
    task: "agent",
  });
  const defaultIsLocal = params.isLocalProvider
    ? params.isLocalProvider(chatDefault.providerId)
    : Boolean(params.personalConnectionIsLocal) &&
      chatDefault.providerId === params.personalConnection.providerId;
  if (defaultIsLocal) return chatDefault.modelId.trim() ? chatDefault : null;
  if (params.hasIntelligence) return ATHAS_AUTOMATIC;
  if (chatDefault.providerId !== "athas" && chatDefault.modelId.trim()) return chatDefault;
  return null;
}
