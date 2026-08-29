import { describe, expect, it } from "vite-plus/test";
import {
  getMonacoScrollbarOptions,
  monacoCodeCellScrollbarOptions,
} from "../engines/monaco/scrollbar-options";

describe("Monaco scrollbar options", () => {
  it("keeps a generous hit area with an inset app-sized thumb", () => {
    expect(getMonacoScrollbarOptions(true)).toMatchObject({
      vertical: "auto",
      horizontal: "auto",
      verticalScrollbarSize: 11,
      verticalSliderSize: 5,
      horizontalScrollbarSize: 11,
      horizontalSliderSize: 5,
      useShadows: false,
    });
  });

  it("disables editor scrolling without changing its geometry contract", () => {
    expect(getMonacoScrollbarOptions(false)).toMatchObject({
      vertical: "hidden",
      horizontal: "hidden",
      handleMouseWheel: false,
      alwaysConsumeMouseWheel: false,
      verticalScrollbarSize: 11,
      verticalSliderSize: 5,
    });
  });

  it("keeps notebook cells horizontally scrollable without trapping vertical scroll", () => {
    expect(monacoCodeCellScrollbarOptions).toMatchObject({
      vertical: "hidden",
      horizontal: "auto",
      alwaysConsumeMouseWheel: false,
      horizontalScrollbarSize: 11,
      horizontalSliderSize: 5,
      useShadows: false,
    });
  });
});
