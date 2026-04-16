import { describe, expect, test } from "vite-plus/test";
import { shouldRequestPaneCollapse } from "../utils/resizable-pane-utils";

describe("shouldRequestPaneCollapse", () => {
  test("does not collapse when pane is not collapsible", () => {
    expect(
      shouldRequestPaneCollapse({
        collapsible: false,
        rawWidth: 100,
        startWidth: 200,
        minWidth: 180,
        collapseThreshold: 48,
      }),
    ).toBe(false);
  });

  test("does not collapse when dragging wider", () => {
    expect(
      shouldRequestPaneCollapse({
        collapsible: true,
        rawWidth: 240,
        startWidth: 200,
        minWidth: 180,
        collapseThreshold: 48,
      }),
    ).toBe(false);
  });

  test("does not collapse when only reaching minimum width", () => {
    expect(
      shouldRequestPaneCollapse({
        collapsible: true,
        rawWidth: 180,
        startWidth: 220,
        minWidth: 180,
        collapseThreshold: 48,
      }),
    ).toBe(false);
  });

  test("collapses only after dragging past the threshold", () => {
    expect(
      shouldRequestPaneCollapse({
        collapsible: true,
        rawWidth: 132,
        startWidth: 220,
        minWidth: 180,
        collapseThreshold: 48,
      }),
    ).toBe(true);
  });
});
