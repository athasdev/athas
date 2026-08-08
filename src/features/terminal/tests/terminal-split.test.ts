import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

describe("terminal splits", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
    workspaceRuntimeRegistry.activateWorkspace({
      id: "terminal-split-workspace",
      name: "Terminal Split",
      path: "/workspace",
    });
  });

  it("tracks right and down split directions and clears them with the companion", () => {
    const dispatch = useTerminalTabsStore.getState().actions.dispatch;
    dispatch({
      type: "CREATE_TERMINAL",
      payload: { id: "primary", name: "Primary", currentDirectory: "/workspace" },
    });
    dispatch({
      type: "CREATE_TERMINAL",
      payload: { id: "companion", name: "Companion", currentDirectory: "/workspace" },
    });

    dispatch({
      type: "SET_TERMINAL_SPLIT_MODE",
      payload: {
        id: "primary",
        splitMode: true,
        splitWithId: "companion",
        splitDirection: "right",
      },
    });
    expect(useTerminalTabsStore.getState().terminals[0]).toMatchObject({
      splitMode: true,
      splitWithId: "companion",
      splitDirection: "right",
    });

    dispatch({
      type: "SET_TERMINAL_SPLIT_MODE",
      payload: {
        id: "primary",
        splitMode: true,
        splitWithId: "companion",
        splitDirection: "down",
      },
    });
    expect(useTerminalTabsStore.getState().terminals[0]?.splitDirection).toBe("down");

    dispatch({ type: "CLOSE_TERMINAL", payload: { id: "companion" } });
    expect(useTerminalTabsStore.getState().terminals[0]).toMatchObject({
      splitMode: false,
      splitWithId: undefined,
      splitDirection: undefined,
    });
  });
});
