// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
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
  return { opened: [] as string[], newChats: 0 };
});

vi.mock("@/features/ai/cloud-agents/hooks/use-cloud-runs", () => ({
  useCloudRun: () => null,
  useCloudRuns: () => ({ runs: [] }),
}));
vi.mock("@/features/ai/services/agent-project-navigation", () => ({
  openAgentSession: (id: string) => io.opened.push(id),
  startProjectlessChat: () => io.newChats++,
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
import { useWorkbenchSidebarStore } from "@/features/layout/stores/workbench-sidebar.store";
import {
  ArchivedSessions,
  ChatSessions,
  PinnedSessions,
  ProjectSessionList,
} from "../components/sidebar/workbench-sessions";

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

const menuLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  );

async function rightClick(element: Element | null | undefined) {
  if (!element) throw new Error("Missing element");
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });
  });
}

async function choose(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!item) throw new Error(`Missing menu item ${label}`);
  await act(async () => fireEvent.click(item));
}

beforeEach(() => {
  Element.prototype.getAnimations = () => [];
  io.opened = [];
  io.newChats = 0;
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
  document.body.innerHTML = "";
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

  it("offers a session's actions on right-click, the same ones as its menu", async () => {
    const pinned = { ...session("pinned", "Pinned session", 1), isPinned: true };
    useAIChatStore.setState({ chats: [pinned] });
    await act(async () => root.render(<PinnedSessions chats={[pinned]} />));

    await rightClick(container.querySelector('[data-session-id="pinned"] button'));
    expect(menuLabels()).toEqual([
      "Open",
      "Open in New Window",
      "Unpin",
      "Rename",
      "Archive",
      "Delete",
    ]);
    await choose("Unpin");
    expect(useAIChatStore.getState().chats[0].isPinned).toBe(false);

    await rightClick(container.querySelector('[data-session-id="pinned"] button'));
    await choose("Open");
    expect(io.opened).toEqual(["pinned"]);
  });

  it("starts a chat or folds the list from the Chats heading", async () => {
    useWorkbenchSidebarStore.setState({ chatsCollapsed: false });
    await act(async () => root.render(<ChatSessions chats={[]} />));
    const heading = () => container.querySelector("[aria-expanded]");

    await rightClick(heading());
    await choose("New chat");
    expect(io.newChats).toBe(1);

    await rightClick(heading());
    await choose("Collapse");
    expect(useWorkbenchSidebarStore.getState().chatsCollapsed).toBe(true);
  });

  it("restores or deletes an archived session from its right-click menu", async () => {
    const archived = { ...session("old", "Old session", 1), archivedAt: new Date() };
    useAIChatStore.setState({ chats: [archived] });
    await act(async () => root.render(<ArchivedSessions chats={[archived]} />));
    await act(async () => container.querySelector<HTMLElement>("[aria-expanded]")?.click());

    await rightClick(
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Old session"),
    );
    expect(menuLabels()).toEqual(["Open", "Restore", "Delete"]);
    await choose("Restore");
    expect(useAIChatStore.getState().chats[0].archivedAt).toBeNull();
  });

  it("shows nothing while no session is pinned", async () => {
    await act(async () => root.render(<PinnedSessions chats={[]} />));
    expect(container.textContent).toBe("");
  });
});
