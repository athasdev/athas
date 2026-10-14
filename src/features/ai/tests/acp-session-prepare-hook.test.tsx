// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  useComposerAcpSession,
  usePrepareAcpSession,
} from "@/features/ai/hooks/use-composer-acp-session";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/acp-stream-handler", () => ({
  AcpStreamHandler: { prepare: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

function Composer({ agentId }: { agentId: string }) {
  usePrepareAcpSession(useComposerAcpSession(null, agentId));
  return null;
}

let root: Root;

async function render(agentId: string) {
  await act(async () => root.render(<Composer agentId={agentId} />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(AcpStreamHandler.prepare).mockClear();
  useAIChatStore.setState({ chats: [], acpSessions: {}, acpPrepares: {}, acpOptionCache: {} });
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("preparing the composer's agent", () => {
  it("prepares the ACP agent the user settles on, not every one passed on the way", async () => {
    await render("gemini-cli");
    await render("qwen-code");
    await act(async () => vi.advanceTimersByTime(1_000));

    expect(AcpStreamHandler.prepare).toHaveBeenCalledExactlyOnceWith("qwen-code", null);
  });

  it("leaves the built-in agent alone", async () => {
    await render("custom");
    await act(async () => vi.advanceTimersByTime(1_000));

    expect(AcpStreamHandler.prepare).not.toHaveBeenCalled();
  });

  it("does not start an agent again after its prepared session went away", async () => {
    await render("gemini-cli");
    await act(async () => vi.advanceTimersByTime(1_000));
    await act(async () =>
      useAIChatStore.setState({
        acpPrepares: {
          "gemini-cli\u0000": { agentId: "gemini-cli", status: "preparing", sessionId: null },
        },
      }),
    );
    // The agent stopped for being idle: its prepared session is gone.
    await act(async () => useAIChatStore.setState({ acpPrepares: {} }));
    await act(async () => vi.advanceTimersByTime(1_000));

    expect(AcpStreamHandler.prepare).toHaveBeenCalledTimes(1);
  });
});
