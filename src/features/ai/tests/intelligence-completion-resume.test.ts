import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

import { enableMapSet } from "immer";
import { commands } from "@/bindings/commands";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useIntelligenceCompletionStore } from "@/features/editor/stores/intelligence-completion.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { storeProviderApiToken } from "../services/ai-token-service";
import {
  canRequestIntelligenceCompletion,
  registerIntelligenceCompletionResume,
} from "../intelligence/services/intelligence-completion-service";
import { useIntelligenceSettingsStore } from "../intelligence/stores/intelligence-settings.store";
import { useAIChatStore } from "../stores/ai-chat.store";

enableMapSet();

const status = () => useIntelligenceCompletionStore.getState().status;
const pause = () => useIntelligenceCompletionStore.getState().actions.pause("api-key", "Add a key");

beforeEach(() => {
  vi.spyOn(commands, "storeAiProviderToken").mockResolvedValue(undefined as never);
  registerIntelligenceCompletionResume();
  registerIntelligenceCompletionResume();
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, aiCompletion: true },
  });
  useIntelligenceCompletionStore.getState().actions.resume();
});

describe("resuming paused Tab autocomplete", () => {
  it("does not run while paused, for sensitive files or without a path", () => {
    expect(canRequestIntelligenceCompletion("/repo/a.ts")).toBe(true);
    expect(canRequestIntelligenceCompletion("")).toBe(false);
    expect(canRequestIntelligenceCompletion("/repo/.env")).toBe(false);
    pause();
    expect(canRequestIntelligenceCompletion("/repo/a.ts")).toBe(false);
  });

  it("resumes when the account changes", () => {
    pause();
    useAuthStore.setState({ user: { id: 42 } as never, isAuthenticated: true });
    expect(status().kind).toBe("idle");
  });

  it("resumes when the intelligence preferences change", () => {
    pause();
    useIntelligenceSettingsStore.setState({
      preferences: { ...useIntelligenceSettingsStore.getState().preferences, autoRouting: false },
    });
    expect(status().kind).toBe("idle");
  });

  it("resumes when an API key is saved or provider access changes", async () => {
    pause();
    await storeProviderApiToken("openai", "sk");
    expect(status().kind).toBe("idle");

    pause();
    useAIChatStore.setState({ providerApiKeys: new Map([["openai", true]]) });
    expect(status().kind).toBe("idle");
  });

  it("resumes when the default model changes, not for unrelated settings", () => {
    pause();
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, uiFontSize: 15 },
    });
    expect(status().kind).toBe("paused");

    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, aiModelId: "another-model" },
    });
    expect(status().kind).toBe("idle");
  });

  it("stays paused when the project changes", () => {
    pause();
    useProjectStore.setState({ rootFolderPath: "/another/project" });
    expect(status().kind).toBe("paused");
  });
});
