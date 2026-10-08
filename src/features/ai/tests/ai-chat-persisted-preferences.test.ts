// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createJSONStorage } from "zustand/middleware";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { skipUnchangedPersistWrites } from "@/features/ai/stores/ai-chat/ai-chat-persist-storage";
import { createMemoryStateStorage } from "@/utils/zustand-storage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
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

const STORAGE_KEY = "athas-ai-chat-settings-v7";

describe("persisted chat preferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes storage only when a persisted preference changes", () => {
    const { actions } = useAIChatStore.getState();
    actions.setPendingAgentLaunchRequest(null);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const writes = () => setItem.mock.calls.filter(([key]) => key === STORAGE_KEY).length;

    useAIChatStore.setState({ chats: [] });
    actions.setPendingAgentLaunchRequest(null);
    actions.setSelectedAgentId(useAIChatStore.getState().selectedAgentId);
    expect(writes()).toBe(0);

    actions.setSelectedAgentId("codex");
    expect(writes()).toBe(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      state: {
        mode: useAIChatStore.getState().mode,
        outputStyle: useAIChatStore.getState().outputStyle,
        selectedAgentId: "codex",
      },
      version: 3,
    });
  });

  it("skips writes equal to the stored value and resumes after a change", () => {
    const backing = createMemoryStateStorage();
    backing.setItem("prefs", JSON.stringify({ state: { mode: "chat" }, version: 1 }));
    const setItem = vi.spyOn(backing, "setItem");
    const storage = skipUnchangedPersistWrites<{ mode: string }>(createJSONStorage(() => backing))!;

    expect(storage.getItem("prefs")).toEqual({ state: { mode: "chat" }, version: 1 });
    storage.setItem("prefs", { state: { mode: "chat" }, version: 1 });
    expect(setItem).not.toHaveBeenCalled();

    storage.setItem("prefs", { state: { mode: "chat" }, version: 2 });
    storage.setItem("prefs", { state: { mode: "plan" }, version: 2 });
    storage.setItem("prefs", { state: { mode: "plan" }, version: 2 });
    expect(setItem).toHaveBeenCalledTimes(2);

    storage.removeItem("prefs");
    storage.setItem("prefs", { state: { mode: "plan" }, version: 2 });
    expect(setItem).toHaveBeenCalledTimes(3);
  });
});
