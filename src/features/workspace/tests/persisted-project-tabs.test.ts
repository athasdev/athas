import { describe, expect, it } from "vite-plus/test";
import { normalizePersistedProjectTabs } from "../utils/persisted-project-tabs";
import { createProjectTabId } from "../utils/project-tab-path";

const tab = (path: string, isActive: boolean, id = createProjectTabId(path)) => ({
  id,
  path,
  isActive,
});

describe("normalizePersistedProjectTabs", () => {
  it("rewrites a non-normalized path and its id", () => {
    expect(normalizePersistedProjectTabs([tab("/a//b/", true, "legacy")])).toEqual([
      tab("/a/b", true),
    ]);
  });

  it("keeps the active flag when a normalized duplicate follows a legacy tab", () => {
    const tabs = normalizePersistedProjectTabs([
      tab("/a//b", false, "legacy"),
      tab("/other", false),
      tab("/a/b", true),
    ]);

    expect(tabs).toEqual([tab("/a/b", true), tab("/other", false)]);
  });

  it("keeps the active flag when a legacy duplicate follows the normalized tab", () => {
    const tabs = normalizePersistedProjectTabs([tab("/a/b", false), tab("/a//b/", true, "legacy")]);

    expect(tabs).toEqual([tab("/a/b", true)]);
  });

  it("drops exact duplicates and returns tabs that need no change as they are", () => {
    const first = tab("/a/b", false);
    const tabs = normalizePersistedProjectTabs([first, tab("/a/b", true)]);

    expect(tabs).toEqual([tab("/a/b", true)]);
    expect(normalizePersistedProjectTabs([first])[0]).toBe(first);
  });
});
