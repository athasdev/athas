// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { opened: [] as string[] };
});

vi.mock("@/features/ai/cloud-agents/hooks/use-cloud-runs", () => ({
  useCloudRun: () => null,
  useCloudRuns: () => ({ runs: [] }),
}));
vi.mock("@/features/ai/services/agent-project-navigation", () => ({
  openAgentSession: (id: string) => io.opened.push(id),
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

import { useAgentPermissionsStore } from "@/features/ai/stores/agent-permissions.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useSessionInboxStore } from "@/features/ai/stores/session-inbox.store";
import type { ChatSession, Message } from "@/features/ai/types/ai-chat.types";
import { ProjectSessionList, SessionInboxList } from "../components/sidebar/workbench-sessions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const session = (id: string, title: string, minutesAgo: number): ChatSession => ({
  id,
  title,
  createdAt: new Date(Date.now() - (minutesAgo + 5) * 60_000),
  lastMessageAt: new Date(Date.now() - minutesAgo * 60_000),
  messageCount: 2,
  agentId: "claude-code",
  acpSessionId: `acp-${id}`,
  workspacePath: "/code/web",
});

const chats = [
  session("working", "Working session", 1),
  session("waiting", "Waiting session", 2),
  session("failed", "Failed session", 3),
  session("done", "Finished session", 4),
  session("quiet", "Quiet session", 5),
  ...Array.from({ length: 3 }, (_, index) => session(`old-${index}`, `Old ${index}`, 60 + index)),
];

let container: HTMLElement;
let root: Root;
const rows = () =>
  [...container.querySelectorAll<HTMLElement>("[data-session-id]")].map((row) => ({
    id: row.dataset.sessionId,
    status: row.dataset.sessionStatus,
    unread: Boolean(row.querySelector("[data-slot=status-dot]")),
  }));

beforeEach(() => {
  io.opened = [];
  useAIChatStore.setState({
    chats,
    messagesByChat: {
      working: [{ id: "m", role: "assistant", content: "", isStreaming: true } as Message],
    },
  });
  useAgentPermissionsStore.setState({
    permissions: [{ id: "p", chatId: "waiting" }] as never,
  });
  useSessionInboxStore.setState({
    outcomes: {
      failed: { outcome: "error", unread: true, at: 1 },
      done: { outcome: "complete", unread: true, at: 1 },
      quiet: { outcome: "complete", unread: false, at: 1 },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("workbench sessions", () => {
  it("lists a project's recent sessions with their status and unread mark", async () => {
    await act(async () =>
      root.render(
        <ProjectSessionList
          projectPath="/code/web"
          sessions={{ projectId: "web", chats, cloudRuns: [] }}
        />,
      ),
    );
    expect(rows()).toEqual([
      { id: "working", status: "running", unread: false },
      { id: "waiting", status: "needs-input", unread: false },
      { id: "failed", status: "failed", unread: true },
      { id: "done", status: "idle", unread: true },
      { id: "quiet", status: "idle", unread: false },
    ]);
    expect(container.textContent).toContain("Show 3 more");
  });

  it("gathers the sessions that need the user in the Inbox, newest first", async () => {
    await act(async () => root.render(<SessionInboxList />));
    expect(rows().map((row) => row.id)).toEqual(["waiting", "failed", "done"]);
    expect(container.textContent).toContain("web");

    await act(async () =>
      container.querySelector<HTMLElement>('[data-session-id="failed"] button')?.click(),
    );
    expect(io.opened).toEqual(["failed"]);
  });

  it("says when nothing needs the user", async () => {
    useAgentPermissionsStore.setState({ permissions: [] });
    useSessionInboxStore.setState({ outcomes: {} });
    await act(async () => root.render(<SessionInboxList />));
    expect(container.textContent).toContain("Nothing needs you");
  });
});
