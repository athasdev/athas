import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../hooks/use-context-menu-prevention";

const { isContextMenuAllowedTarget } = __test__;

function targetWithClosest(result: unknown): EventTarget {
  return {
    closest: (selector: string) => {
      expect(selector).toBe(".monaco-editor, .monaco-editor-shell, .monaco-menu-container");
      return result;
    },
  } as unknown as EventTarget;
}

describe("context menu prevention", () => {
  it("allows Monaco editor context menu targets", () => {
    expect(isContextMenuAllowedTarget(targetWithClosest({ className: "monaco-editor" }))).toBe(
      true,
    );
  });

  it("allows Monaco menu targets rendered outside the editor shell", () => {
    expect(
      isContextMenuAllowedTarget(targetWithClosest({ className: "monaco-menu-container" })),
    ).toBe(true);
  });

  it("keeps non-Monaco targets blocked", () => {
    expect(isContextMenuAllowedTarget(targetWithClosest(null))).toBe(false);
    expect(isContextMenuAllowedTarget({} as EventTarget)).toBe(false);
    expect(isContextMenuAllowedTarget(null)).toBe(false);
  });
});
