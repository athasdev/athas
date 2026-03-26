import { describe, expect, test } from "bun:test";
import { withProjectLoadingState } from "./project-loading";

type TestState = {
  isFileTreeLoading: boolean;
  isSwitchingProject: boolean;
};

const createTestState = (): TestState => ({
  isFileTreeLoading: false,
  isSwitchingProject: false,
});

const createStateSetter = (state: TestState) => {
  return (recipe: (draft: TestState) => void) => {
    recipe(state);
  };
};

describe("withProjectLoadingState", () => {
  test("clears file-tree loading state after a successful load", async () => {
    const state = createTestState();

    const result = await withProjectLoadingState(createStateSetter(state), async () => {
      expect(state.isFileTreeLoading).toBe(true);
      expect(state.isSwitchingProject).toBe(false);
      return "loaded";
    });

    expect(result).toBe("loaded");
    expect(state).toEqual({
      isFileTreeLoading: false,
      isSwitchingProject: false,
    });
  });

  test("clears file-tree loading state after a failed load", async () => {
    const state = createTestState();

    await expect(
      withProjectLoadingState(createStateSetter(state), async () => {
        expect(state.isFileTreeLoading).toBe(true);
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");

    expect(state).toEqual({
      isFileTreeLoading: false,
      isSwitchingProject: false,
    });
  });

  test("clears both loading flags after a failed project switch", async () => {
    const state = createTestState();

    await expect(
      withProjectLoadingState(
        createStateSetter(state),
        async () => {
          expect(state.isFileTreeLoading).toBe(true);
          expect(state.isSwitchingProject).toBe(true);
          throw new Error("switch failed");
        },
        { includeSwitchingProject: true },
      ),
    ).rejects.toThrow("switch failed");

    expect(state).toEqual({
      isFileTreeLoading: false,
      isSwitchingProject: false,
    });
  });
});
