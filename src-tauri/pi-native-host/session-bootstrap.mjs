const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function normalizeTextContent(content) {
  if (typeof content !== "string") {
    return null;
  }

  return content.length > 0 ? content : null;
}

export function buildBootstrapMessages(history, model) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  const startedAt = Date.now();
  const messages = [];

  for (const [index, entry] of history.entries()) {
    const content = normalizeTextContent(entry?.content);
    if (!content) {
      continue;
    }

    const timestamp = startedAt + index;
    if (entry.role === "user") {
      messages.push({
        role: "user",
        content,
        timestamp,
      });
      continue;
    }

    if (entry.role === "assistant" && model) {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: ZERO_USAGE,
        stopReason: "stop",
        timestamp,
      });
    }
  }

  return messages;
}

export function applyBootstrapHistory(session, history) {
  const existingEntries = session.sessionManager.getEntries();
  const hasConversationEntries = existingEntries.some(
    (entry) => entry.type === "message" || entry.type === "custom_message",
  );
  if (hasConversationEntries) {
    return false;
  }

  const bootstrapMessages = buildBootstrapMessages(history, session.model);
  if (bootstrapMessages.length === 0) {
    return false;
  }

  const hasThinkingLevelEntry = existingEntries.some(
    (entry) => entry.type === "thinking_level_change",
  );
  if (!hasThinkingLevelEntry) {
    session.sessionManager.appendThinkingLevelChange(session.thinkingLevel);
  }

  const hasModelEntry = existingEntries.some((entry) => entry.type === "model_change");
  if (session.model && !hasModelEntry) {
    session.sessionManager.appendModelChange(session.model.provider, session.model.id);
  }

  for (const message of bootstrapMessages) {
    session.sessionManager.appendMessage(message);
  }

  const sessionContext = session.sessionManager.buildSessionContext();
  session.agent.replaceMessages(sessionContext.messages);
  return true;
}
