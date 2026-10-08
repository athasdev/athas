import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

const dispatch = (...args: Parameters<ReturnType<typeof getState>["actions"]["dispatch"]>) =>
  getState().actions.dispatch(...args);
const getState = () => useTerminalTabsStore.getState();

function createTerminal(id: string) {
  dispatch({ type: "CREATE_TERMINAL", payload: { id, name: id, currentDirectory: "/workspace" } });
}

describe("terminal tabs keep one active terminal fact", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
    workspaceRuntimeRegistry.activateWorkspace({ id: "terminals", name: "T", path: "/workspace" });
  });

  it("tracks the active terminal by id only, without rewriting the terminal list", () => {
    createTerminal("one");
    createTerminal("two");
    createTerminal("three");
    const terminals = getState().terminals;

    expect(getState().activeTerminalId).toBe("three");
    expect(terminals.every((terminal) => !("isActive" in terminal))).toBe(true);

    dispatch({ type: "SET_ACTIVE_TERMINAL", payload: { id: "one" } });
    expect(getState().activeTerminalId).toBe("one");
    expect(getState().terminals).toBe(terminals);

    createTerminal("two");
    expect(getState().activeTerminalId).toBe("two");
    expect(getState().terminals).toBe(terminals);
  });

  it("keeps order and the active id consistent through reorder and close", () => {
    createTerminal("one");
    createTerminal("two");
    createTerminal("three");
    dispatch({ type: "SET_ACTIVE_TERMINAL", payload: { id: "two" } });

    dispatch({ type: "REORDER_TERMINALS", payload: { fromIndex: 0, toIndex: 2 } });
    expect(getState().terminals.map((terminal) => terminal.id)).toEqual(["two", "three", "one"]);
    expect(getState().activeTerminalId).toBe("two");

    dispatch({ type: "CLOSE_TERMINAL", payload: { id: "two" } });
    expect(getState().terminals.map((terminal) => terminal.id)).toEqual(["three", "one"]);
    expect(getState().activeTerminalId).toBe("three");

    dispatch({ type: "CLOSE_TERMINAL", payload: { id: "one" } });
    dispatch({ type: "CLOSE_TERMINAL", payload: { id: "three" } });
    expect(getState().activeTerminalId).toBeNull();
  });

  it("restores the first saved terminal as active", () => {
    dispatch({
      type: "RESTORE_TERMINALS",
      payload: {
        terminals: [
          { id: "a", name: "A", currentDirectory: "/workspace", isPinned: false },
          { id: "b", name: "B", currentDirectory: "/workspace", isPinned: true },
        ],
        layouts: [],
      },
    });

    expect(getState().activeTerminalId).toBe("a");
    expect(getState().terminals.map((terminal) => terminal.id)).toEqual(["a", "b"]);
  });
});

describe("terminal pane visibility", () => {
  it("is derived from the bottom pane state", () => {
    expect(
      selectIsTerminalPaneVisible({ isBottomPaneVisible: true, bottomPaneActiveTab: "terminal" }),
    ).toBe(true);
    expect(
      selectIsTerminalPaneVisible({ isBottomPaneVisible: false, bottomPaneActiveTab: "terminal" }),
    ).toBe(false);
    expect(
      selectIsTerminalPaneVisible({ isBottomPaneVisible: true, bottomPaneActiveTab: "problems" }),
    ).toBe(false);
  });
});
