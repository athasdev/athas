import { describe, expect, it } from "vite-plus/test";
import { __test__ } from "../hooks/use-context-menu-prevention";

const { isContextMenuAllowedTarget } = __test__;

function targetWithClosest(result: unknown): EventTarget {
  return {
    closest: (selector: string) => {
      expect(selector).toBe(".cm-editor");
      return result;
    },
  } as unknown as EventTarget;
}

describe("context menu prevention", () => {
  it("allows editor context menu targets", () => {
    expect(isContextMenuAllowedTarget(targetWithClosest({ className: "cm-editor" }))).toBe(true);
  });

  it("keeps non-editor targets blocked", () => {
    expect(isContextMenuAllowedTarget(targetWithClosest(null))).toBe(false);
    expect(isContextMenuAllowedTarget({} as EventTarget)).toBe(false);
    expect(isContextMenuAllowedTarget(null)).toBe(false);
  });
});
