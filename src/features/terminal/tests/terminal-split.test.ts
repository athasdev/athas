import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  generateTerminalId,
  useTerminalTabsStore,
} from "@/features/terminal/stores/terminal-tabs.store";
import { getLayoutTerminalIds } from "@/features/terminal/utils/terminal-layout";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

function createTerminal(id: string) {
  useTerminalTabsStore.getState().actions.dispatch({
    type: "CREATE_TERMINAL",
    payload: { id, name: id, currentDirectory: "/workspace" },
  });
}

describe("terminal splits", () => {
  it("creates distinct sessions when identical commands open in the same clock tick", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const first = generateTerminalId("Shell");
      const second = generateTerminalId("Shell");
      createTerminal(first);
      createTerminal(second);
      expect(first).not.toBe(second);
      expect(useTerminalTabsStore.getState().terminals).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
    workspaceRuntimeRegistry.activateWorkspace({
      id: "terminal-split-workspace",
      name: "Terminal Split",
      path: "/workspace",
    });
  });

  it("keeps split terminals in a layout tree and focuses the new pane", () => {
    const { dispatch } = useTerminalTabsStore.getState().actions;
    createTerminal("primary");
    createTerminal("companion");

    dispatch({
      type: "SPLIT_TERMINAL",
      payload: { terminalId: "primary", newTerminalId: "companion", direction: "right" },
    });

    const state = useTerminalTabsStore.getState();
    expect(state.layouts).toHaveLength(1);
    expect(getLayoutTerminalIds(state.layouts[0])).toEqual(["primary", "companion"]);
    expect(state.activeTerminalId).toBe("companion");
  });

  it("activates a sibling pane when the active member of a layout closes", () => {
    const { dispatch } = useTerminalTabsStore.getState().actions;
    createTerminal("standalone");
    createTerminal("primary");
    createTerminal("companion");
    dispatch({
      type: "SPLIT_TERMINAL",
      payload: { terminalId: "primary", newTerminalId: "companion", direction: "down" },
    });

    dispatch({ type: "CLOSE_TERMINAL", payload: { id: "companion" } });

    const state = useTerminalTabsStore.getState();
    expect(state.activeTerminalId).toBe("primary");
    expect(state.layouts).toEqual([]);
    expect(state.terminals.map((terminal) => terminal.id)).toEqual(["standalone", "primary"]);
  });

  it("unsplits a terminal back into a standalone tab", () => {
    const { dispatch } = useTerminalTabsStore.getState().actions;
    createTerminal("primary");
    createTerminal("companion");
    dispatch({
      type: "SPLIT_TERMINAL",
      payload: { terminalId: "primary", newTerminalId: "companion", direction: "right" },
    });

    dispatch({ type: "UNSPLIT_TERMINAL", payload: { terminalId: "companion" } });

    const state = useTerminalTabsStore.getState();
    expect(state.layouts).toEqual([]);
    expect(state.terminals).toHaveLength(2);
  });

  it("restores persisted layouts for the terminals that came back", () => {
    const { dispatch } = useTerminalTabsStore.getState().actions;
    createTerminal("primary");
    createTerminal("companion");
    dispatch({
      type: "SPLIT_TERMINAL",
      payload: { terminalId: "primary", newTerminalId: "companion", direction: "right" },
    });
    const persisted = JSON.parse(JSON.stringify(useTerminalTabsStore.getState().layouts));

    dispatch({
      type: "RESTORE_TERMINALS",
      payload: {
        terminals: [
          { id: "primary", name: "primary", currentDirectory: "/workspace", isPinned: false },
          { id: "companion", name: "companion", currentDirectory: "/workspace", isPinned: false },
        ],
        layouts: persisted,
      },
    });
    expect(getLayoutTerminalIds(useTerminalTabsStore.getState().layouts[0])).toEqual([
      "primary",
      "companion",
    ]);

    dispatch({
      type: "RESTORE_TERMINALS",
      payload: {
        terminals: [
          { id: "primary", name: "primary", currentDirectory: "/workspace", isPinned: false },
        ],
        layouts: persisted,
      },
    });
    expect(useTerminalTabsStore.getState().layouts).toEqual([]);
  });
});
