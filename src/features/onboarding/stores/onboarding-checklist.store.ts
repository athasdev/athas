import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isOnboardingChecklistTaskId,
  type OnboardingChecklistTaskId,
} from "@/features/onboarding/lib/onboarding-checklist";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";

interface OnboardingChecklistState {
  completedTaskIds: OnboardingChecklistTaskId[];
  actions: {
    completeTask: (taskId: OnboardingChecklistTaskId) => void;
  };
}

type PersistedOnboardingChecklistState = Pick<OnboardingChecklistState, "completedTaskIds">;

const useOnboardingChecklistStoreBase = create<OnboardingChecklistState>()(
  persist(
    (set) => ({
      completedTaskIds: [],
      actions: {
        completeTask: (taskId) =>
          set((state) => ({
            completedTaskIds: state.completedTaskIds.includes(taskId)
              ? state.completedTaskIds
              : [...state.completedTaskIds, taskId],
          })),
      },
    }),
    {
      name: "athas-onboarding-checklist-v1",
      version: 1,
      storage: createSafeJSONStorage<PersistedOnboardingChecklistState>(),
      migrate: (persistedState, version): PersistedOnboardingChecklistState => {
        const persisted = persistedState as Partial<PersistedOnboardingChecklistState> | undefined;

        return {
          completedTaskIds:
            version === 0 || !Array.isArray(persisted?.completedTaskIds)
              ? []
              : persisted.completedTaskIds.filter(isOnboardingChecklistTaskId),
        };
      },
      partialize: (state) => ({
        completedTaskIds: state.completedTaskIds,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedOnboardingChecklistState> | undefined;

        return {
          ...currentState,
          completedTaskIds: Array.isArray(persisted?.completedTaskIds)
            ? persisted.completedTaskIds.filter(isOnboardingChecklistTaskId)
            : [],
        };
      },
    },
  ),
);

export const useOnboardingChecklistStore = createSelectors(useOnboardingChecklistStoreBase);
