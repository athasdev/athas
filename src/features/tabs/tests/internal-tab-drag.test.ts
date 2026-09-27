import { describe, expect, it } from "vite-plus/test";
import { getGlobalTabMove } from "../utils/internal-tab-drag";

function applyMove(ids: string[], move: [number, number] | null) {
  if (!move) return ids;
  const next = [...ids];
  const [moved] = next.splice(move[0], 1);
  next.splice(move[1], 0, moved);
  return next;
}

// Two panes share one global buffer list: a, c and e are in the left pane, b and d in the right.
const globalIds = ["a", "b", "c", "d", "e"];
const leftPane = ["a", "c", "e"];

function leftOrder(ids: string[]) {
  return ids.filter((id) => leftPane.includes(id));
}

describe("getGlobalTabMove", () => {
  it("reorders a pane's tabs without disturbing the other pane's", () => {
    const moved = applyMove(globalIds, getGlobalTabMove(globalIds, "e", "a", leftPane));
    expect(leftOrder(moved)).toEqual(["e", "a", "c"]);
    expect(moved.filter((id) => !leftPane.includes(id))).toEqual(["b", "d"]);
  });

  it("moves a tab to the end of its pane", () => {
    const moved = applyMove(globalIds, getGlobalTabMove(globalIds, "a", null, leftPane));
    expect(leftOrder(moved)).toEqual(["c", "e", "a"]);
  });

  it("moves a tab later in the pane", () => {
    const moved = applyMove(globalIds, getGlobalTabMove(globalIds, "a", "e", leftPane));
    expect(leftOrder(moved)).toEqual(["c", "a", "e"]);
  });

  it("places a tab from another pane before the tab under the pointer", () => {
    const withB = ["a", "b", "c", "e"];
    const moved = applyMove(globalIds, getGlobalTabMove(globalIds, "b", "e", withB));
    expect(moved.filter((id) => withB.includes(id))).toEqual(["a", "c", "b", "e"]);
  });

  it("returns null when the tab is already in place or unknown", () => {
    expect(getGlobalTabMove(globalIds, "a", "c", leftPane)).toBeNull();
    expect(getGlobalTabMove(globalIds, "e", null, leftPane)).toBeNull();
    expect(getGlobalTabMove(globalIds, "missing", "a", leftPane)).toBeNull();
    expect(getGlobalTabMove(globalIds, "a", "missing", leftPane)).toBeNull();
  });
});
