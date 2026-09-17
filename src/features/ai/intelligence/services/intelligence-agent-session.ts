const active = new Map<string, AbortController>();

export function beginIntelligenceAgent(sessionId: string) {
  if (active.has(sessionId)) throw new Error("This session already has an active request.");
  const controller = new AbortController();
  active.set(sessionId, controller);
  return controller;
}

export function cancelIntelligenceAgent(sessionId: string) {
  active.get(sessionId)?.abort();
}

export function finishIntelligenceAgent(sessionId: string, controller: AbortController) {
  controller.abort();
  if (active.get(sessionId) === controller) active.delete(sessionId);
}
