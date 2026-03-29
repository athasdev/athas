import { describe, expect, test } from "bun:test";
import { applyBootstrapHistory, buildBootstrapMessages } from "./session-bootstrap.mjs";

describe("pi-native session bootstrap", () => {
  test("builds user and assistant bootstrap messages using the active model", () => {
    const messages = buildBootstrapMessages(
      [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "READY" },
      ],
      {
        api: "openai-codex-responses",
        provider: "openai-codex",
        id: "gpt-5.4",
      },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "hello",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      provider: "openai-codex",
      model: "gpt-5.4",
      content: [{ type: "text", text: "READY" }],
      stopReason: "stop",
    });
  });

  test("hydrates a fresh session manager and syncs agent state", () => {
    const appended = [];
    const replaced = [];
    const session = {
      model: {
        api: "openai-codex-responses",
        provider: "openai-codex",
        id: "gpt-5.4",
      },
      thinkingLevel: "medium",
      sessionManager: {
        getEntries() {
          return [];
        },
        appendThinkingLevelChange(level) {
          appended.push({ type: "thinking", level });
        },
        appendModelChange(provider, modelId) {
          appended.push({ type: "model", provider, modelId });
        },
        appendMessage(message) {
          appended.push({ type: "message", message });
        },
        buildSessionContext() {
          return {
            messages: appended
              .filter((entry) => entry.type === "message")
              .map((entry) => entry.message),
          };
        },
      },
      agent: {
        replaceMessages(messages) {
          replaced.push(messages);
        },
      },
    };

    const applied = applyBootstrapHistory(session, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "READY" },
    ]);

    expect(applied).toBe(true);
    expect(appended[0]).toEqual({ type: "thinking", level: "medium" });
    expect(appended[1]).toEqual({
      type: "model",
      provider: "openai-codex",
      modelId: "gpt-5.4",
    });
    expect(appended.slice(2).map((entry) => entry.type)).toEqual(["message", "message"]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toHaveLength(2);
  });

  test("still imports history when the session already has model metadata but no messages", () => {
    const appended = [];
    const replaced = [];
    const existingEntries = [{ type: "model_change" }, { type: "thinking_level_change" }];
    const session = {
      model: {
        api: "openai-codex-responses",
        provider: "openai-codex",
        id: "gpt-5.4",
      },
      thinkingLevel: "medium",
      sessionManager: {
        getEntries() {
          return existingEntries;
        },
        appendThinkingLevelChange(level) {
          appended.push({ type: "thinking", level });
        },
        appendModelChange(provider, modelId) {
          appended.push({ type: "model", provider, modelId });
        },
        appendMessage(message) {
          appended.push({ type: "message", message });
        },
        buildSessionContext() {
          return {
            messages: appended
              .filter((entry) => entry.type === "message")
              .map((entry) => entry.message),
          };
        },
      },
      agent: {
        replaceMessages(messages) {
          replaced.push(messages);
        },
      },
    };

    const applied = applyBootstrapHistory(session, [{ role: "user", content: "hello again" }]);

    expect(applied).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: "message",
      message: { role: "user", content: "hello again" },
    });
    expect(replaced[0]).toHaveLength(1);
  });
});
