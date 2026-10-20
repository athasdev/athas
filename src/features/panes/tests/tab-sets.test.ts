// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { getAllPaneGroups } from "../services/pane-tree";
import { usePaneStore } from "../stores/pane.store";
import {
  getSessionTabSet,
  getTabSetBufferIds,
  PROJECT_TAB_SET,
  pruneTabSet,
  useTabSetsStore,
} from "../stores/tab-sets.store";

const file = (id: string, isDirty = false): PaneContent =>
  ({
    id,
    type: "editor",
    path: `/work/site/${id}.ts`,
    name: `${id}.ts`,
    content: "",
    savedContent: "",
    isDirty,
    isVirtual: false,
  }) as PaneContent;

const tabs = () =>
  getAllPaneGroups(usePaneStore.getState().root).flatMap((group) => group.bufferIds);
const open = (buffer: PaneContent) => {
  useBufferStore.setState((state) => ({ ...state, buffers: [...state.buffers, buffer] }));
  usePaneStore.getState().actions.placeBuffer(buffer.id);
};
const agentBufferOf = (chatId: string) =>
  useBufferStore
    .getState()
    .buffers.find((buffer) => buffer.type === "agent" && buffer.sessionId === chatId)?.id;

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  localStorage.clear();
});

describe("tab sets", () => {
  it("gives a session its own tabs and keeps the project's aside", () => {
    open(file("readme"));
    useBufferStore.getState().actions.openAgentBuffer("chat-1");

    expect(useTabSetsStore.getState().activeOwner).toBe(getSessionTabSet("chat-1"));
    expect(tabs()).toEqual([agentBufferOf("chat-1")]);

    open(file("pricing"));
    expect(tabs()).toEqual([agentBufferOf("chat-1"), "pricing"]);

    useTabSetsStore.getState().actions.switchTo(PROJECT_TAB_SET);
    expect(tabs()).toEqual(["readme"]);

    useBufferStore.getState().actions.openAgentBuffer("chat-1");
    expect(tabs()).toEqual([agentBufferOf("chat-1"), "pricing"]);
  });

  it("moves a session's tab out of the project's tabs when the session opens on its own", () => {
    open(file("readme"));
    const agent = useBufferStore.getState().actions.openContent({
      type: "agent",
      sessionId: "chat-2",
    });
    expect(tabs()).toEqual(["readme", agent]);

    useBufferStore.getState().actions.openAgentBuffer("chat-2");
    useTabSetsStore.getState().actions.switchTo(PROJECT_TAB_SET);
    expect(tabs()).toEqual(["readme"]);
  });

  it("closes a tab another set shows without closing its buffer or asking to save", () => {
    open(file("shared", true));
    useBufferStore.getState().actions.openAgentBuffer("chat-3");
    usePaneStore.getState().actions.placeBuffer("shared");
    expect(tabs()).toContain("shared");

    useBufferStore.getState().actions.closeBuffer("shared");
    expect(useBufferStore.getState().pendingClose).toBeNull();
    expect(tabs()).not.toContain("shared");
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.id === "shared")).toBe(true);

    useTabSetsStore.getState().actions.switchTo(PROJECT_TAB_SET);
    expect(tabs()).toEqual(["shared"]);
  });

  it("hands the centre back to the project once a session's last tab closes", () => {
    open(file("readme"));
    const agent = useBufferStore.getState().actions.openAgentBuffer("chat-4");
    useBufferStore.getState().actions.closeBuffer(agent);
    expect(useTabSetsStore.getState().activeOwner).toBe(PROJECT_TAB_SET);
    expect(tabs()).toEqual(["readme"]);
  });

  it("drops buffers closed since a set was put aside, and the splits they emptied", () => {
    const layout = {
      root: {
        id: "split",
        type: "split" as const,
        direction: "horizontal" as const,
        sizes: [50, 50] as [number, number],
        children: [
          { id: "left", type: "group" as const, bufferIds: ["a", "b"], activeBufferId: "b" },
          { id: "right", type: "group" as const, bufferIds: ["c"], activeBufferId: "c" },
        ] as [never, never],
      },
      activePaneId: "right",
      fullscreenPaneId: null,
    };
    const pruned = pruneTabSet(layout, (bufferId) => bufferId === "a");
    expect(pruned.root).toMatchObject({ id: "left", type: "group", bufferIds: ["a"] });
    expect(getTabSetBufferIds(pruned)).toEqual(["a"]);
  });

  it("forgets a deleted session's set and comes back to the project's", () => {
    open(file("readme"));
    useBufferStore.getState().actions.openAgentBuffer("chat-5");
    useTabSetsStore.getState().actions.forget(getSessionTabSet("chat-5"));
    expect(useTabSetsStore.getState().activeOwner).toBe(PROJECT_TAB_SET);
    expect(useTabSetsStore.getState().stored[getSessionTabSet("chat-5")]).toBeUndefined();
    expect(tabs()).toEqual(["readme"]);
  });
});
