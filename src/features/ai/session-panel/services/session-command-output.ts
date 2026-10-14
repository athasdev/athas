type SessionCommandOutputListener = (chatId: string, text: string) => void;

const listeners = new Set<SessionCommandOutputListener>();

/**
 * Hands output a session's command printed to whoever watches for servers in it, for agents that
 * stream command output outside the transcript, such as Codex.
 */
export function reportSessionCommandOutput(chatId: string, text: string) {
  for (const listener of listeners) listener(chatId, text);
}

export function onSessionCommandOutput(listener: SessionCommandOutputListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
