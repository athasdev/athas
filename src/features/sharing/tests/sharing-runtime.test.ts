import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Chat } from "@/features/ai/types/ai-chat.types";

const state = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  chats: [] as Chat[],
  loadAll: vi.fn(),
  loadChat: vi.fn(),
  options: vi.fn(),
  request: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: typeof state.effect) => {
    state.effect = effect;
  },
}));
vi.mock("@/features/window/services/auth-api", () => ({ getAuthToken: async () => "token" }));
vi.mock("@/features/window/stores/auth.store", () => ({
  useAuthStore: Object.assign(() => 1, { getState: () => ({ user: { id: 1 } }) }),
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: { getState: () => ({ chats: state.chats }) },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ buffers: [] }) },
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  initChatDatabase: async () => {},
  loadAllChatsFromDb: state.loadAll,
  loadChatFromDb: state.loadChat,
}));
vi.mock("../services/share-api", () => ({
  fetchShareOptions: state.options,
  shareRequest: state.request,
  updateShare: vi.fn(),
}));
vi.mock("../services/share-device", () => ({ getShareDeviceId: () => "device" }));
import { SharingRuntime } from "../components/sharing-runtime";

let cleanup: (() => void) | undefined;
const chat = (id: string, time: number): Chat => ({
  id,
  title: id,
  createdAt: new Date(time),
  lastMessageAt: new Date(time),
  agentId: "custom",
  messages: [
    { id: `${id}-message`, role: "user", content: `Conversation ${id}`, timestamp: new Date(time) },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { dispatchEvent: state.dispatch });
  state.chats = [];
  state.options.mockResolvedValue({ sessionsEnabled: true, items: [], excludedSources: [] });
  state.request.mockResolvedValue({ id: "cloud", revision: 1 });
});
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});
async function sync() {
  SharingRuntime();
  cleanup = state.effect?.();
  await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalled());
}

describe("private session sync", () => {
  it("uploads saved history without opening the agent view, newest first", async () => {
    state.loadAll.mockResolvedValue([chat("old", 100), chat("new", 200)]);
    state.loadChat.mockImplementation(async (id) => chat(id, id === "new" ? 200 : 100));
    await sync();
    expect(state.request.mock.calls.map((call) => JSON.parse(call[1].body).sourceId)).toEqual([
      "new",
      "old",
    ]);
    expect(JSON.parse(state.request.mock.calls[0][1].body)).toMatchObject({
      visibility: "private",
      sourceUpdatedAt: 200,
    });
  });
  it("uses the latest in-memory response over persisted history", async () => {
    state.chats = [chat("active", 300)];
    state.loadAll.mockResolvedValue([chat("active", 100)]);
    await sync();
    expect(state.loadChat).not.toHaveBeenCalled();
    expect(JSON.parse(state.request.mock.calls[0][1].body).sourceUpdatedAt).toBe(300);
  });
  it("continues syncing other sessions after one upload fails", async () => {
    state.loadAll.mockResolvedValue([chat("old", 100), chat("new", 200)]);
    state.loadChat.mockImplementation(async (id) => chat(id, 100));
    state.request.mockRejectedValueOnce(new Error("Failed upload"));
    await sync();
    expect(state.request).toHaveBeenCalledTimes(2);
    expect(state.dispatch.mock.calls[0][0].detail.error).toBe("Failed upload");
  });
  it("does not read or upload history when sync is disabled", async () => {
    state.options.mockResolvedValue({ sessionsEnabled: false, items: [], excludedSources: [] });
    await sync();
    expect(state.loadAll).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  });
  it("does not recreate deleted cloud copies", async () => {
    state.loadAll.mockResolvedValue([chat("deleted", 100)]);
    state.loadChat.mockResolvedValue(chat("deleted", 100));
    state.options.mockResolvedValue({
      sessionsEnabled: true,
      items: [],
      excludedSources: [{ deviceId: "device", sourceId: "deleted" }],
    });
    await sync();
    expect(state.request).not.toHaveBeenCalled();
  });
});
