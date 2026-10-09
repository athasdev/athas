import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { registerAiSettingsEffects } from "../services/ai-settings-effects";
import { getProvider } from "../services/providers/ai-provider-registry";
import type { OllamaProvider } from "../services/providers/ollama-provider";
import type { OpenAICompatibleProvider } from "../services/providers/openai-compatible-provider";
import {
  runSettingEffect,
  runSettingsEffects,
} from "@/features/settings/services/settings-effect-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

const ollama = () => getProvider("ollama") as OllamaProvider;
const custom = () => getProvider("custom") as OpenAICompatibleProvider;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(commands, "getAiProviderToken").mockImplementation(async (providerId: string) =>
    providerId === "ollama" ? "cloud-key" : null,
  );
  registerAiSettingsEffects();
});

describe("AI provider settings effects", () => {
  it("points the providers at the saved endpoints and loads the Ollama key", async () => {
    runSettingsEffects({
      ...useSettingsStore.getState().settings,
      ollamaBaseUrl: "https://ollama.com",
      aiCustomBaseUrl: "http://127.0.0.1:1234/v1",
    });
    await vi.waitFor(() => expect(ollama().getApiKey()).toBe("cloud-key"));

    expect(ollama().getBaseUrl()).toBe("https://ollama.com");
    expect(custom().buildUrl()).toBe("http://127.0.0.1:1234/v1/chat/completions");
  });

  it("follows single setting changes and ignores an empty Ollama URL", async () => {
    runSettingEffect("ollamaBaseUrl", "http://gpu-box:11434");
    runSettingEffect("aiCustomBaseUrl", "http://lan-llm:8000/v1");
    await vi.waitFor(() => {
      expect(ollama().getBaseUrl()).toBe("http://gpu-box:11434");
      expect(custom().buildUrl()).toBe("http://lan-llm:8000/v1/chat/completions");
    });

    runSettingEffect("ollamaBaseUrl", "");
    await settle();
    expect(ollama().getBaseUrl()).toBe("http://gpu-box:11434");
  });
});
