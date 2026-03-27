import { describe, expect, test } from "bun:test";
import { getChatSurfaceLayout } from "./chat-surface-layout";

describe("getChatSurfaceLayout", () => {
  test("gives Harness a centered shell with a secondary rail", () => {
    expect(getChatSurfaceLayout("harness")).toEqual({
      shellMaxWidthClassName: "max-w-[1480px]",
      timelineMaxWidthClassName: "max-w-[980px]",
      composerMaxWidthClassName: "max-w-[1040px]",
      railContainerClassName: "xl:w-[280px]",
      showsSecondaryRail: true,
    });
  });

  test("keeps panel chat compact and rail-free", () => {
    expect(getChatSurfaceLayout("panel")).toEqual({
      shellMaxWidthClassName: "max-w-none",
      timelineMaxWidthClassName: "max-w-none",
      composerMaxWidthClassName: "max-w-none",
      railContainerClassName: null,
      showsSecondaryRail: false,
    });
  });
});
