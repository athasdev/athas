import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { getLayoutTerminalIds } from "@/features/terminal/utils/terminal-layout";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

function createTerminal(id: string) {
  useTerminalTabsStore.getState().actions.dispatch({
    type: "CREATE_TERMINAL",
    payload: { id, name: id, currentDirectory: "/workspace" },
  });
}

describe("terminal splits", () => {
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

  it("drops layouts when terminals are reset or restored", () => {
    const { dispatch } = useTerminalTabsStore.getState().actions;
    createTerminal("primary");
    createTerminal("companion");
    dispatch({
      type: "SPLIT_TERMINAL",
      payload: { terminalId: "primary", newTerminalId: "companion", direction: "right" },
    });

    dispatch({ type: "RESET_TERMINALS", payload: {} });
    expect(useTerminalTabsStore.getState().layouts).toEqual([]);
  });
});
