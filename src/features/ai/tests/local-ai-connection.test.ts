import { describe, expect, it } from "vite-plus/test";
import {
  resolveAutocompleteConnection,
  resolveIntelligenceConnection,
} from "../intelligence/lib/resolve-intelligence-connection";
import { defaultIntelligencePreferences } from "../intelligence/lib/intelligence-preferences";
import {
  getLocalChatConnection,
  isLocalAiProvider,
  isLocalEndpointUrl,
} from "../lib/local-ai-connection";

const settings = {
  ollamaBaseUrl: "http://localhost:11434",
  aiCustomBaseUrl: "",
  aiAutocompleteCustomBaseUrl: "",
};

describe("Local AI connections", () => {
  it("recognizes endpoints on this machine or the local network", () => {
    for (const url of [
      "http://localhost:11434",
      "http://127.0.0.1:8080/v1",
      "http://[::1]:11434",
      "http://192.168.1.20:11434",
      "http://10.0.0.5",
      "http://172.20.1.1",
      "http://gpu-box.local:11434",
      "http://100.101.102.103:11434",
    ])
      expect(isLocalEndpointUrl(url), url).toBe(true);
    for (const url of [
      "https://ollama.com",
      "https://api.example.com/v1",
      "http://8.8.8.8",
      "http://100.128.0.1",
      "",
    ])
      expect(isLocalEndpointUrl(url), url).toBe(false);
  });

  it("treats Ollama as local unless it points at Ollama Cloud or a public host", () => {
    expect(isLocalAiProvider("ollama", settings)).toBe(true);
    expect(isLocalAiProvider("ollama", { ...settings, ollamaBaseUrl: "192.168.1.9:9000" })).toBe(
      true,
    );
    expect(isLocalAiProvider("ollama", { ...settings, ollamaBaseUrl: "https://ollama.com" })).toBe(
      false,
    );
    expect(isLocalAiProvider("athas", settings)).toBe(false);
    expect(isLocalAiProvider("openai", settings)).toBe(false);
  });

  it("treats a custom endpoint as local only when its host is", () => {
    expect(
      isLocalAiProvider("custom", { ...settings, aiCustomBaseUrl: "http://localhost:1234/v1" }),
    ).toBe(true);
    expect(
      isLocalAiProvider("custom", { ...settings, aiCustomBaseUrl: "https://api.together.xyz/v1" }),
    ).toBe(false);
  });

  it("keeps a local chat's side requests on the chat's own model", () => {
    expect(
      getLocalChatConnection(
        { agentId: "custom", providerId: "ollama", modelId: "qwen3-coder" },
        settings,
      ),
    ).toEqual({ providerId: "ollama", modelId: "qwen3-coder" });
    expect(
      getLocalChatConnection({ agentId: "custom", providerId: "athas", modelId: "auto" }, settings),
    ).toBeNull();
    expect(
      getLocalChatConnection({ agentId: "claude-code", providerId: "ollama" }, settings),
    ).toBeNull();
  });

  it("routes automatic tasks to a local default instead of hosted Athas", () => {
    const personalConnection = { providerId: "ollama", modelId: "qwen3-coder" };
    for (const task of ["agent", "chat-title", "commit-message"] as const) {
      expect(
        resolveIntelligenceConnection({
          task,
          preferences: defaultIntelligencePreferences(),
          hasIntelligence: true,
          personalConnection,
          personalConnectionIsLocal: true,
        }),
      ).toEqual(personalConnection);
    }
    expect(
      resolveAutocompleteConnection({
        preferences: defaultIntelligencePreferences(),
        hasIntelligence: true,
        personalConnection,
        personalConnectionIsLocal: true,
      }),
    ).toEqual(personalConnection);
  });
});

describe("Tab completion connection", () => {
  const openai = { providerId: "openai", modelId: "gpt-5" };
  const ollama = { providerId: "ollama", modelId: "qwen3-coder" };
  const isLocalProvider = (providerId: string) => providerId === "ollama";

  it("uses the Athas Tab model on Automatic instead of following the default model", () => {
    const preferences = defaultIntelligencePreferences();
    preferences.defaultConnection = openai;
    expect(
      resolveAutocompleteConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: openai,
        isLocalProvider,
      }),
    ).toEqual({ providerId: "athas", modelId: "auto" });
  });

  it("stays off Athas when the default model is local", () => {
    const preferences = defaultIntelligencePreferences();
    preferences.defaultConnection = ollama;
    expect(
      resolveAutocompleteConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: openai,
        isLocalProvider,
      }),
    ).toEqual(ollama);

    preferences.defaultConnection = { providerId: "ollama", modelId: "" };
    expect(
      resolveAutocompleteConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: openai,
        isLocalProvider,
      }),
    ).toBeNull();
  });

  it("keeps Tab local when only new chats use a hosted model next to a local default", () => {
    const preferences = defaultIntelligencePreferences();
    preferences.defaultConnection = ollama;
    preferences.tasks.agent = openai;
    expect(
      resolveAutocompleteConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: ollama,
        isLocalProvider,
      }),
    ).toEqual(ollama);
  });

  it("falls back to the user's own-key default without Athas access", () => {
    expect(
      resolveAutocompleteConnection({
        preferences: defaultIntelligencePreferences(),
        hasIntelligence: false,
        personalConnection: openai,
        isLocalProvider,
      }),
    ).toEqual(openai);
  });

  it("needs a choice when Automatic has nothing to run on", () => {
    expect(
      resolveAutocompleteConnection({
        preferences: defaultIntelligencePreferences(),
        hasIntelligence: false,
        personalConnection: { providerId: "athas", modelId: "auto" },
        isLocalProvider,
      }),
    ).toBeNull();
  });

  it("honors an explicit Tab model, even a hosted one next to a local default", () => {
    const preferences = defaultIntelligencePreferences();
    preferences.defaultConnection = ollama;
    preferences.tasks.autocomplete = openai;
    expect(
      resolveAutocompleteConnection({
        preferences,
        hasIntelligence: false,
        personalConnection: ollama,
        isLocalProvider,
      }),
    ).toEqual(openai);

    preferences.tasks.autocomplete = { providerId: "athas", modelId: "" };
    expect(
      resolveAutocompleteConnection({
        preferences,
        hasIntelligence: true,
        personalConnection: ollama,
        isLocalProvider,
      }),
    ).toEqual({ providerId: "athas", modelId: "auto" });
  });
});
