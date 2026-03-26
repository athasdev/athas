import type { AIChatState } from "./types";

export const normalizePersistedAIChatState = (
  persistedState: unknown,
): Partial<AIChatState> | undefined => {
  if (!persistedState || typeof persistedState !== "object") {
    return undefined;
  }

  const wrappedState = (persistedState as { state?: Partial<AIChatState> }).state;
  if (wrappedState && typeof wrappedState === "object") {
    return wrappedState;
  }

  return persistedState as Partial<AIChatState>;
};
