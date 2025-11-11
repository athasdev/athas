import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalProfile } from "@/features/terminal/types/terminal";
import { createSelectors } from "@/utils/zustand-selectors";

interface TerminalProfilesState {
  profiles: TerminalProfile[];
  actions: {
    addProfile: (profile: Omit<TerminalProfile, "id">) => void;
    updateProfile: (id: string, updates: Partial<TerminalProfile>) => void;
    deleteProfile: (id: string) => void;
    getProfile: (id: string) => TerminalProfile | undefined;
  };
}

const useTerminalProfilesStoreBase = create<TerminalProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [],
      actions: {
        addProfile: (profile) => {
          const id = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          set((state) => ({
            profiles: [...state.profiles, { ...profile, id }],
          }));
        },
        updateProfile: (id, updates) => {
          set((state) => ({
            profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...updates } : p)),
          }));
        },
        deleteProfile: (id) => {
          set((state) => ({
            profiles: state.profiles.filter((p) => p.id !== id),
          }));
        },
        getProfile: (id) => {
          return get().profiles.find((p) => p.id === id);
        },
      },
    }),
    {
      name: "terminal-profiles",
    },
  ),
);

export const useTerminalProfilesStore = createSelectors(useTerminalProfilesStoreBase);
