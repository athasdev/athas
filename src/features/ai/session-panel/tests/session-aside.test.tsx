// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const boxes = vi.hoisted(() => ({ data: null as unknown }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("../hooks/use-session-boxes", () => ({ useSessionBoxes: () => boxes.data }));
vi.mock("../hooks/use-branch-pull-request", () => ({ useBranchPullRequest: () => null }));
vi.mock("../components/session-tool-card", () => ({
  SessionToolCard: ({ placement, beside }: { placement: string; beside: string }) => (
    <div data-slot="session-tool-card" data-placement={placement} data-beside={beside} />
  ),
}));
vi.mock("@/features/browser/services/browser-tab-manager", () => ({
  browserTabManager: { navigate },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: Object.assign(() => undefined, {
    use: { actions: () => ({ openPRBuffer: vi.fn(), openBrowserBuffer: vi.fn() }) },
    getState: () => ({ actions: { openBrowserBuffer: vi.fn() } }),
  }),
}));
vi.mock("@/features/layout/stores/ui-state.store", () => ({
  useUIState: (select: (state: { openSettings: () => void }) => unknown) =>
    select({ openSettings: vi.fn() }),
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (select: (state: { handleFileSelect: () => void }) => unknown) =>
    select({ handleFileSelect: vi.fn() }),
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: (select: (state: { rootFolderPath: string }) => unknown) =>
    select({ rootFolderPath: "/p" }),
}));
vi.mock("@/features/workspace/project-icons/components/project-glyph", () => ({
  ProjectGlyph: () => <span />,
}));
vi.mock("@/extensions/icon-themes/components/themed-file-icon", () => ({
  ThemedFileIcon: () => <span />,
}));

const { AgentSessionLayout } = await import("../components/agent-session-layout");
const { SessionAside } = await import("../components/session-aside");
const { selectSessionPanel, useSessionPanelStore } = await import("../stores/session-panel.store");

const change = (path: string) => ({
  path,
  displayPath: path.slice(3),
  oldText: "",
  newText: "x",
  additions: 1,
  deletions: 0,
  edits: 1,
  phase: "completed",
  timestamp: 0,
});

let width = 1600;
let container: HTMLDivElement;
let root: Root;
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const panel = (chatId = "chat-1") => selectSessionPanel(useSessionPanelStore.getState(), chatId);
const actions = () => useSessionPanelStore.getState().actions;
const find = (selector: string) => container.querySelector<HTMLElement>(selector);
const boxIds = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-slot=session-box]")).map(
    (box) => box.dataset.box,
  );

async function render(chatId = "chat-1") {
  await act(async () =>
    root.render(
      <AgentSessionLayout key={`${chatId}-${width}`} chatId={chatId}>
        <div>
          <SessionAside
            chatId={chatId}
            agentBufferId="agent-buffer"
            paneId="pane"
            workingDirectory="/p"
          />
        </div>
      </AgentSessionLayout>,
    ),
  );
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    fireEvent.click(element!);
  });
}

beforeEach(() => {
  localStorage.clear();
  width = 1600;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  boxes.data = {
    visible: ["environment", "changes", "running"],
    environment: {
      name: "app",
      displayPath: "~/app",
      location: { kind: "local" },
      workspacePath: "/p",
      iconPath: undefined,
      branch: "main",
    },
    context: null,
    changes: { files: [change("/p/a.ts"), change("/p/b.ts")], additions: 2, deletions: 0 },
    running: [{ kind: "server", url: "http://localhost:5173/", command: "bun dev" }],
    plan: null,
    connectors: [],
  };
  useSessionPanelStore.setState({
    panels: {},
    servers: {},
    liveServers: {},
    attention: {},
    focusRequests: {},
    selectedChanges: {},
    collapsedBoxes: {},
    boxesHidden: false,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
});

describe("session aside", () => {
  it("stacks the session's boxes in a column when the session is wide", async () => {
    await render();
    expect(find("[data-slot=session-box-column]")).not.toBeNull();
    expect(find("[data-slot=session-box-rail]")).toBeNull();
    expect(boxIds()).toEqual(["environment", "changes", "running"]);
    expect(container.textContent).toContain("~/app");
    expect(find("[data-slot=session-tool-card]")).toBeNull();
  });

  it("folds a box to its header and keeps it folded in every session", async () => {
    await render();
    await click(find("[data-box=environment] button[aria-expanded]"));
    expect(useSessionPanelStore.getState().collapsedBoxes).toEqual({ environment: true });
    expect(find("[data-box=environment]")?.dataset.collapsed).toBe("true");
    expect(container.textContent).not.toContain("~/app");
    const stored = JSON.parse(localStorage.getItem("athas-agent-session-panels-v1") ?? "{}");
    expect(stored.state.collapsedBoxes).toEqual({ environment: true });

    await render("chat-2");
    expect(find("[data-box=environment]")?.dataset.collapsed).toBe("true");
    await click(find("[data-box=environment] button[aria-expanded]"));
    expect(container.textContent).toContain("~/app");
  });

  it("opens a changed file in the Changes tool, folding the column into its rail until it closes", async () => {
    await render();
    await click(find('[data-slot=session-box-column] [data-path="/p/b.ts"]'));
    expect(panel()).toMatchObject({ open: true, tab: "changes" });
    expect(useSessionPanelStore.getState().selectedChanges["chat-1"]).toBe("/p/b.ts");
    expect(find("[data-slot=session-tool-card]")?.dataset.placement).toBe("split");
    expect(find("[data-slot=session-box-column]")).toBeNull();
    expect(find("[data-slot=session-box-rail]")).not.toBeNull();

    await act(async () => actions().close("chat-1"));
    expect(find("[data-slot=session-tool-card]")).toBeNull();
    expect(find("[data-slot=session-box-column]")).not.toBeNull();
  });

  it("opens a running server in the session's browser", async () => {
    await render();
    await click(find('[data-box=running] button[aria-label^="Open localhost:5173"]'));
    expect(panel()).toMatchObject({
      open: true,
      tab: "browser",
      browserUrl: "http://localhost:5173/",
    });
  });

  it("keeps each session's open tool when switching sessions", async () => {
    actions().open("chat-1", "terminal");
    await render("chat-1");
    expect(find("[data-slot=session-tool-card]")).not.toBeNull();

    await render("chat-2");
    expect(find("[data-slot=session-tool-card]")).toBeNull();
    expect(find("[data-slot=session-box-column]")).not.toBeNull();

    await render("chat-1");
    expect(find("[data-slot=session-tool-card]")).not.toBeNull();
    expect(panel("chat-1")).toMatchObject({ open: true, tab: "terminal" });
  });

  it("folds into a rail in a narrow session, each icon opening its box", async () => {
    width = 800;
    await render();
    expect(find("[data-slot=session-box-column]")).toBeNull();
    const rail = find("[data-slot=session-box-rail]");
    expect(
      Array.from(rail?.querySelectorAll<HTMLElement>("button[data-box]") ?? []).map(
        (button) => button.dataset.box,
      ),
    ).toEqual(["environment", "changes", "running"]);

    await click(rail!.querySelector("button[data-box=changes]"));
    const popover = document.body.querySelector("[data-slot=popover-content]");
    expect(popover?.textContent).toContain("Changes");
    await click(popover!.querySelector('[data-path="/p/a.ts"]'));
    expect(panel()).toMatchObject({ open: true, tab: "changes" });
    expect(useSessionPanelStore.getState().selectedChanges["chat-1"]).toBe("/p/a.ts");
    expect(find("[data-slot=session-tool-card]")?.dataset.placement).toBe("split");
  });

  it("lets an open tool cover a session too narrow to split, beside the rail", async () => {
    width = 500;
    actions().open("chat-1", "changes");
    await render();
    const card = find("[data-slot=session-tool-card]");
    expect(card?.dataset.placement).toBe("cover");
    expect(card?.dataset.beside).toBe("rail");
  });

  it("shows no boxes once the user hides them, while tools still open", async () => {
    useSessionPanelStore.setState({ boxesHidden: true });
    await render();
    expect(find("[data-slot=session-box-column]")).toBeNull();
    expect(find("[data-slot=session-box-rail]")).toBeNull();

    await act(async () => actions().open("chat-1", "browser"));
    expect(find("[data-slot=session-tool-card]")?.dataset.beside).toBe("edge");
  });
});
