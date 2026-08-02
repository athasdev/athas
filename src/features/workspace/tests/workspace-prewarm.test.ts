import { beforeEach, describe, expect, it } from "vitest";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { orderWorkspacePrewarmCandidates } from "@/features/workspace/services/workspace-prewarm";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";

const createTab = (id: string): ProjectTab => ({
  id,
  name: id,
  path: `/${id}`,
  isActive: false,
  lastOpened: 0,
});

describe("workspace prewarm ordering", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
  });

  it("prepares adjacent inactive workspaces before distant workspaces", () => {
    const tabs = ["a", "b", "c", "d"].map(createTab);

    expect(orderWorkspacePrewarmCandidates(tabs, "c", () => true).map((tab) => tab.id)).toEqual([
      "b",
      "d",
      "a",
    ]);
  });

  it("excludes ineligible and already-ready workspaces", () => {
    const tabs = ["a", "b", "c", "d"].map(createTab);
    workspaceRuntimeRegistry.ensureWorkspace({ id: "b", name: "b", path: "/b" }, "ready");

    expect(
      orderWorkspacePrewarmCandidates(tabs, "c", (tab) => tab.id !== "d").map((tab) => tab.id),
    ).toEqual(["a"]);
  });
});
