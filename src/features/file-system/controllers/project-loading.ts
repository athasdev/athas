import type { FsState } from "../types/interface";

type ProjectLoadingState = Pick<FsState, "isFileTreeLoading" | "isSwitchingProject">;

export type ProjectLoadingStateSetter<State extends ProjectLoadingState> = (
  recipe: (state: State) => void,
) => void;

export const withProjectLoadingState = async <State extends ProjectLoadingState, Result>(
  setState: ProjectLoadingStateSetter<State>,
  operation: () => Promise<Result>,
  options: {
    includeSwitchingProject?: boolean;
  } = {},
): Promise<Result> => {
  const { includeSwitchingProject = false } = options;

  setState((state) => {
    state.isFileTreeLoading = true;
    if (includeSwitchingProject) {
      state.isSwitchingProject = true;
    }
  });

  try {
    return await operation();
  } finally {
    setState((state) => {
      state.isFileTreeLoading = false;
      if (includeSwitchingProject) {
        state.isSwitchingProject = false;
      }
    });
  }
};
