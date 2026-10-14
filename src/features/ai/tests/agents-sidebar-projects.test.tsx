// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  openAgentSession: vi.fn(),
  startAgentInProject: vi.fn(),
}));

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
vi.mock("@/features/ai/services/agent-project-navigation", () => mocks);
vi.mock("@/features/ai/components/sidebar/agents-plan-footer", () => ({
  AgentsPlanFooter: () => null,
}));
vi.mock("@/features/ai/hooks/use-agent-display-names", () => ({
  useAgentDisplayNames: () => ({ getName: (agentId: string) => agentId }),
}));

import { AgentsSidebar } from "@/features/ai/components/sidebar/agents-sidebar";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";

const session = (id: string, workspacePath: string, minutesAgo: number): ChatSession => ({
  id,
  title: `Session ${id}`,
  messageCount: 2,
  createdAt: new Date(Date.now() - 60 * 60_000),
  lastMessageAt: new Date(Date.now() - minutesAgo * 60_000),
  agentId: "claude-code",
  acpSessionId: null,
  workspacePath,
  providerId: null,
  modelId: null,
  branch: null,
  isPinned: false,
  archivedAt: null,
});

const project = (id: string, name: string, path: string, isActive: boolean) => ({
  id,
  name,
  path,
  isActive,
  lastOpened: 0,
});

let root: Root;
let container: HTMLDivElement;

const sectionNames = () =>
  [...container.querySelectorAll("section[aria-label$=' agents']")].map((section) =>
    section.getAttribute("aria-label"),
  );

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "athas", name: "athas", path: "/work/athas" });
  useProjectStore.getState().actions.setRootFolderPath("/work/athas");
  useWorkspaceTabsStore.setState({
    projectTabs: [
      project("client", "client-app", "/work/client-app", false),
      project("athas", "athas", "/work/athas", true),
      project("browser", "athas-browser", "/work/athas-browser", false),
    ],
  });
  useAIChatStore.setState({
    chats: [
      session("athas-1", "/work/athas", 5),
      session("client-1", "/work/client-app", 2),
      session("client-2", "/work/client-app", 30),
      session("closed-1", "/work/closed-project", 1),
    ],
    messagesByChat: {
      "client-1": [{ id: "m", role: "assistant", content: "", isStreaming: true } as never],
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AgentsSidebar />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AgentsSidebar with several projects open", () => {
  it("groups every open project's sessions under that project, in tab order", () => {
    expect(sectionNames()).toEqual(["client-app agents", "athas agents", "athas-browser agents"]);
    const client = container.querySelector("section[aria-label='client-app agents']")!;
    expect(client.textContent).toContain("Session client-1");
    expect(client.textContent).toContain("Session client-2");
    expect(container.textContent).not.toContain("Session closed-1");
    expect(client.textContent).not.toContain("closed-1");
  });

  it("keeps a collapsed project's running agents visible on its header", async () => {
    const client = container.querySelector("section[aria-label='client-app agents']")!;
    expect(client.querySelector('[aria-label="An agent is working in client-app"]')).toBeNull();

    await act(async () => {
      fireEvent.click(client.querySelector("button[aria-expanded]")!);
    });
    expect(client.textContent).not.toContain("Session client-1");
    expect(client.querySelector('[aria-label="An agent is working in client-app"]')).not.toBeNull();
  });

  it("opens a session from another project through the project switch", () => {
    fireEvent.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Session client-2"),
      )!,
    );
    expect(mocks.openAgentSession).toHaveBeenCalledWith("client-2");
  });

  it("starts a new session in the project it is asked from", () => {
    fireEvent.click(container.querySelector('[aria-label="New Agent in client-app"]')!);
    expect(mocks.startAgentInProject).toHaveBeenCalledWith("client");

    const browser = container.querySelector("section[aria-label='athas-browser agents']")!;
    fireEvent.click(
      [...browser.querySelectorAll("button")].find((button) => button.textContent === "New Agent")!,
    );
    expect(mocks.startAgentInProject).toHaveBeenLastCalledWith("browser");
  });

  it("hides projects without matches while filtering", async () => {
    const filter = container.querySelector<HTMLInputElement>('input[aria-label="Filter agents"]')!;
    await act(async () => {
      fireEvent.change(filter, { target: { value: "client-2" } });
    });
    expect(sectionNames()).toEqual(["client-app agents"]);
  });
});
