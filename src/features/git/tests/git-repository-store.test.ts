import { afterEach, describe, expect, it } from "vite-plus/test";
import { useRepositoryStore } from "../stores/git-repository.store";

describe("git repository store", () => {
  afterEach(() => {
    useRepositoryStore.getState().actions.reset();
  });

  it("keeps multiple manually added repositories available", () => {
    const { actions } = useRepositoryStore.getState();

    actions.setManualRepository("/repo/one");
    actions.setManualRepository("/repo/two");

    expect(useRepositoryStore.getState().manualRepoPaths).toEqual(["/repo/one", "/repo/two"]);
    expect(useRepositoryStore.getState().availableRepoPaths).toEqual(["/repo/one", "/repo/two"]);
    expect(useRepositoryStore.getState().activeRepoPath).toBe("/repo/two");
  });

  it("clears manually added repositories together", () => {
    const { actions } = useRepositoryStore.getState();

    actions.setManualRepository("/repo/one");
    actions.setManualRepository("/repo/two");
    actions.clearManualRepository();

    expect(useRepositoryStore.getState().manualRepoPaths).toEqual([]);
    expect(useRepositoryStore.getState().availableRepoPaths).toEqual([]);
    expect(useRepositoryStore.getState().activeRepoPath).toBeNull();
  });
});
