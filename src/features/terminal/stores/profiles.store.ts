import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import type { TerminalProfile } from "@/features/terminal/types/terminal.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { createJSONStorageFrom, createSafeJSONStorage } from "@/utils/zustand-storage";

interface TerminalProfilesState {
  profiles: TerminalProfile[];
  actions: {
    addProfile: (profile: Omit<TerminalProfile, "id">) => void;
    updateProfile: (id: string, updates: Partial<TerminalProfile>) => void;
    deleteProfile: (id: string) => void;
    getProfile: (id: string) => TerminalProfile | undefined;
  };
}

type PersistedTerminalProfilesState = Pick<TerminalProfilesState, "profiles">;

export function createTerminalProfilesStore(storage?: StateStorage) {
  return create<TerminalProfilesState>()(
    persist(
      (set, get) => ({
        profiles: [],
        actions: {
          addProfile: (profile) => {
            const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            set((state) => ({
              profiles: [...state.profiles, { ...profile, id }],
            }));
          },
          updateProfile: (id, updates) => {
            set((state) => ({
              profiles: state.profiles.map((profile) =>
                profile.id === id ? { ...profile, ...updates } : profile,
              ),
            }));
          },
          deleteProfile: (id) => {
            set((state) => ({
              profiles: state.profiles.filter((profile) => profile.id !== id),
            }));
          },
          getProfile: (id) => get().profiles.find((profile) => profile.id === id),
        },
      }),
      {
        name: "terminal-profiles",
        storage: storage
          ? createJSONStorageFrom<PersistedTerminalProfilesState>(storage)
          : createSafeJSONStorage<PersistedTerminalProfilesState>(),
        partialize: (state) => ({ profiles: state.profiles }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...(persistedState as PersistedTerminalProfilesState),
          actions: currentState.actions,
        }),
      },
    ),
  );
}

const useTerminalProfilesStoreBase = createTerminalProfilesStore();

export const useTerminalProfilesStore = createSelectors(useTerminalProfilesStoreBase);
