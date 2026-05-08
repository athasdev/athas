import { describe, expect, it, vi } from "vite-plus/test";
import { enableMapSet } from "immer";

enableMapSet();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: vi.fn(),
    onDragDropEvent: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(),
  }),
}));

import { getEditorContext } from "../command-executor";
import { getOperator } from "../../operators/operator-registry";
import { createFindCharMotion } from "../../motions/character-motions";

describe("find char with operator (df; dt;)", () => {
  it("df; deletes to found char inclusive", () => {
    const context = getEditorContext();
    // getEditorContext returns null when not in a real editor environment
    // so we test the building blocks directly

    const lines = ["hello; world"];
    const motion = createFindCharMotion(";", "forward", "find");
    const range = motion.calculate({ line: 0, column: 0, offset: 0 }, lines);

    // Should find ';' at column 5
    expect(range.end.column).toBe(5);
    expect(range.inclusive).toBe(true);
  });

  it("dt; deletes to found char exclusive", () => {
    const lines = ["hello; world"];
    const motion = createFindCharMotion(";", "forward", "to");
    const range = motion.calculate({ line: 0, column: 0, offset: 0 }, lines);

    // 'to' stops before ';' at column 4
    expect(range.end.column).toBe(4);
    expect(range.inclusive).toBe(true);
  });

  it("operator lookup works for d", () => {
    const op = getOperator("d");
    expect(op).toBeDefined();
    expect(op?.name).toBe("delete");
  });

  it("operator lookup works for c", () => {
    const op = getOperator("c");
    expect(op).toBeDefined();
    expect(op?.name).toBe("change");
    expect(op?.entersInsertMode).toBe(true);
  });
});
