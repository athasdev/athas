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
import type { ChatSession, Message } from "@/features/ai/types/ai-chat.types";
import { PinnedSessions, ProjectSessionList } from "../components/sidebar/workbench-sessions";

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
  session("quiet", "Quiet session", 3),
  ...Array.from({ length: 5 }, (_, index) => session(`old-${index}`, `Old ${index}`, 60 + index)),
];

let container: HTMLElement;
let root: Root;
const rows = () =>
  [...container.querySelectorAll<HTMLElement>("[data-session-id]")].map((row) => ({
    id: row.dataset.sessionId,
    status: row.dataset.sessionStatus,
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("workbench sessions", () => {
  it("lists a project's recent sessions with their status", async () => {
    await act(async () =>
      root.render(
        <ProjectSessionList
          projectId="web"
          projectPath="/code/web"
          sessions={{ projectId: "web", chats, cloudRuns: [] }}
        />,
      ),
    );
    expect(rows()).toEqual([
      { id: "working", status: "running" },
      { id: "waiting", status: "needs-input" },
      { id: "quiet", status: "idle" },
      { id: "old-0", status: "idle" },
      { id: "old-1", status: "idle" },
    ]);
    expect(container.textContent).toContain("Show 3 more");
  });

  it("lists pinned sessions under their own label and opens them", async () => {
    const pinned = [{ ...session("pinned", "Pinned session", 1), isPinned: true }];
    await act(async () => root.render(<PinnedSessions chats={pinned} />));
    expect(container.querySelector("[aria-label='Pinned sessions']")?.textContent).toContain(
      "Pinned",
    );
    expect(rows().map((row) => row.id)).toEqual(["pinned"]);

    await act(async () =>
      container.querySelector<HTMLElement>('[data-session-id="pinned"] button')?.click(),
    );
    expect(io.opened).toEqual(["pinned"]);
  });

  it("shows nothing while no session is pinned", async () => {
    await act(async () => root.render(<PinnedSessions chats={[]} />));
    expect(container.textContent).toBe("");
  });
});
