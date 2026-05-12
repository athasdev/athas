import { describe, expect, it } from "vite-plus/test";
import { resolveEditorWheelIntent } from "../hooks/use-editor-wheel-forwarding";

describe("editor wheel forwarding", () => {
  it("keeps normal vertical wheel movement vertical", () => {
    expect(resolveEditorWheelIntent({ deltaX: 0, deltaY: 80, shiftKey: false })).toEqual({
      deltaTop: 80,
      deltaLeft: 0,
      isHorizontalIntent: false,
    });
  });

  it("keeps horizontal trackpad movement horizontal", () => {
    expect(resolveEditorWheelIntent({ deltaX: 40, deltaY: 10, shiftKey: false })).toEqual({
      deltaTop: 0,
      deltaLeft: 40,
      isHorizontalIntent: true,
    });
  });

  it("maps shift-wheel vertical movement to horizontal scrolling", () => {
    expect(resolveEditorWheelIntent({ deltaX: 0, deltaY: 60, shiftKey: true })).toEqual({
      deltaTop: 0,
      deltaLeft: 60,
      isHorizontalIntent: true,
    });
  });
});
