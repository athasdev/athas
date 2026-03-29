import { describe, expect, test } from "bun:test";
import { getChatSurfaceLayout } from "./chat-surface-layout";

describe("getChatSurfaceLayout", () => {
  test("gives Harness a centered shell with a secondary rail", () => {
    expect(getChatSurfaceLayout("harness")).toEqual({
      shellMaxWidthClassName: "max-w-none",
      timelineMaxWidthClassName: "max-w-3xl",
      composerMaxWidthClassName: "max-w-3xl pt-2",
      railContainerClassName: "hidden xl:flex xl:w-[220px] transition-all",
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
