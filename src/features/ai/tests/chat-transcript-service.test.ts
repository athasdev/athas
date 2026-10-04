import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Chat } from "../types/ai-chat.types";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  open: vi.fn(() => "buffer"),
  toast: vi.fn(),
  getChat: vi.fn(),
  state: { chatMessageLoadStates: {}, agentRuns: {}, actions: {} } as Record<string, any>,
}));
vi.mock("../stores/ai-chat.store", () => ({ useAIChatStore: { getState: () => mocks.state } }));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ actions: { openContent: mocks.open } }) },
}));
vi.mock("@/features/layout/contexts/toast-context", () => ({ showToast: mocks.toast }));
import { openChatTranscript } from "../services/chat-transcript-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    chatMessageLoadStates: {},
    agentRuns: {},
    actions: { loadChatMessages: mocks.load, getChatById: mocks.getChat },
  };
  mocks.getChat.mockReturnValue({
    id: "c",
    title: "Review",
    messages: [{ role: "user", content: "Check this" }],
  } as Chat);
  mocks.load.mockImplementation(async () => {
    mocks.state.chatMessageLoadStates.c = "loaded";
  });
});
describe("open conversation transcript", () => {
  it("loads saved messages before opening a local Markdown snapshot", async () => {
    expect(await openChatTranscript("c")).toBe("buffer");
    expect(mocks.load).toHaveBeenCalledWith("c");
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        isVirtual: true,
        language: "markdown",
        content: expect.stringContaining("Check this"),
      }),
    );
  });
  it("uses the current run without replacing live messages with saved history", async () => {
    mocks.state.agentRuns.c = { status: "running" };
    await openChatTranscript("c");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it("does not open an incomplete transcript after a failed load", async () => {
    mocks.load.mockResolvedValue(undefined);
    expect(await openChatTranscript("c")).toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });
  it("does not create a tab for a conversation deleted during loading", async () => {
    mocks.getChat.mockReturnValue(undefined);
    expect(await openChatTranscript("c")).toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
