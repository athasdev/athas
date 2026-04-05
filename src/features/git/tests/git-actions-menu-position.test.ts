import { describe, expect, test } from "vite-plus/test";
import { resolveGitActionsMenuPosition } from "../utils/git-actions-menu-position";

describe("resolveGitActionsMenuPosition", () => {
  const viewport = { width: 320, height: 240 };
  const menuSize = { width: 200, height: 160 };

  test("right-aligns the menu to the trigger when there is room", () => {
    expect(
      resolveGitActionsMenuPosition({
        anchorRect: {
          left: 140,
          right: 180,
          top: 40,
          bottom: 60,
          width: 40,
          height: 20,
        },
        menuSize,
        viewport,
      }),
    ).toEqual({
      left: 8,
      top: 66,
      direction: "down",
    });
  });

  test("clamps the menu inside the viewport near the right edge", () => {
    expect(
      resolveGitActionsMenuPosition({
        anchorRect: {
          left: 292,
          right: 312,
          top: 40,
          bottom: 60,
          width: 20,
          height: 20,
        },
        menuSize,
        viewport,
      }),
    ).toEqual({
      left: 112,
      top: 66,
      direction: "down",
    });
  });

  test("opens upward when there is not enough room below", () => {
    expect(
      resolveGitActionsMenuPosition({
        anchorRect: {
          left: 292,
          right: 312,
          top: 210,
          bottom: 230,
          width: 20,
          height: 20,
        },
        menuSize,
        viewport,
      }),
    ).toEqual({
      left: 112,
      top: 44,
      direction: "up",
    });
  });

  test("clamps upward-opening menus inside the top margin when needed", () => {
    expect(
      resolveGitActionsMenuPosition({
        anchorRect: {
          left: 100,
          right: 120,
          top: 20,
          bottom: 40,
          width: 20,
          height: 20,
        },
        menuSize: { width: 200, height: 260 },
        viewport,
      }),
    ).toEqual({
      left: 8,
      top: 8,
      direction: "down",
    });
  });
});
