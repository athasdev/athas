import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { migrateLegacyIntelligencePreferences } from "../lib/legacy-intelligence-preferences";
import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import {
  defaultIntelligencePreferences,
  parseIntelligencePreferences,
} from "../lib/intelligence-preferences";
import {
  fetchIntelligenceSettings,
  IntelligenceSettingsError,
} from "../services/intelligence-settings-api";
import type {
  IntelligencePreferences,
  IntelligenceScope,
  IntelligenceSnapshot,
} from "../types/intelligence.types";

interface State {
  userId: number | null;
  scope: string;
  scopes: IntelligenceScope[];
  preferences: IntelligencePreferences;
  revision: number;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  actions: {
    setUser: (userId: number | null) => Promise<void>;
    setScope: (scope: string) => Promise<void>;
    change: (preferences: IntelligencePreferences) => void;
    refresh: (discardLocal?: boolean) => Promise<void>;
    save: () => Promise<void>;
  };
}

interface Dependencies {
  initialPreferences?: () => IntelligencePreferences;
  request: typeof fetchIntelligenceSettings;
  storage: () => Pick<Storage, "getItem" | "setItem"> | null;
}

const personalScope = { id: "personal", name: "Personal", canEdit: true };

export function createIntelligenceSettingsStore(
  dependencies: Dependencies = {
    request: fetchIntelligenceSettings,
    initialPreferences: () =>
      migrateLegacyIntelligencePreferences(useSettingsStore.getState().settings),
    storage: () => (typeof localStorage === "undefined" ? null : localStorage),
  },
) {
  let generation = 0;
  let initialized = false;
  const key = (userId: number | null, scope: string) =>
    `athas.intelligence.${userId ?? "local"}.${scope}`;
  const selectedScopeKey = (userId: number | null) =>
    `athas.intelligence.${userId ?? "local"}.scope`;
  function cached(userId: number | null, scope: string) {
    try {
      const raw = JSON.parse(dependencies.storage()?.getItem(key(userId, scope)) || "null");
      return {
        preferences: parseIntelligencePreferences(
          raw?.preferences ?? (userId === null ? dependencies.initialPreferences?.() : undefined),
        ),
        revision: Number.isSafeInteger(raw?.revision) && raw.revision >= 0 ? raw.revision : 0,
        dirty: raw?.dirty === true,
      };
    } catch {
      return { preferences: defaultIntelligencePreferences(), revision: 0, dirty: false };
    }
  }
  function persist(state: State) {
    dependencies.storage()?.setItem(
      key(state.userId, state.scope),
      JSON.stringify({
        preferences: state.preferences,
        revision: state.revision,
        dirty: state.dirty,
      }),
    );
  }
  return create<State>()((set, get) => ({
    userId: null,
    scope: "personal",
    scopes: [personalScope],
    preferences: defaultIntelligencePreferences(),
    revision: 0,
    dirty: false,
    loading: false,
    error: null,
    actions: {
      setUser: async (userId) => {
        if (initialized && get().userId === userId) return;
        initialized = true;
        generation += 1;
        let scope = "personal";
        if (userId !== null) {
          const saved = dependencies.storage()?.getItem(selectedScopeKey(userId));
          if (saved && /^team:[1-9]\d*$/.test(saved)) scope = saved;
        }
        set({
          userId,
          scope,
          scopes: [personalScope],
          ...cached(userId, scope),
          loading: false,
          error: null,
        });
        await get().actions.refresh();
        if (userId === null) persist(get());
      },
      setScope: async (scope) => {
        if (!get().scopes.some((item) => item.id === scope)) return;
        generation += 1;
        const userId = get().userId;
        dependencies.storage()?.setItem(selectedScopeKey(userId), scope);
        set({ scope, ...cached(userId, scope), loading: false, error: null });
        await get().actions.refresh();
      },
      change: (preferences) => {
        const state = get();
        if (
          state.scope !== "personal" &&
          !state.scopes.find((scope) => scope.id === state.scope)?.canEdit
        )
          return;
        set({ preferences: parseIntelligencePreferences(preferences), dirty: true, error: null });
        persist(get());
      },
      refresh: async (discardLocal = false) => {
        const state = get();
        if (state.userId === null) return;
        const ticket = ++generation;
        set({ loading: true, error: null });
        try {
          const snapshot = await dependencies.request(state.scope, undefined, state.userId);
          if (ticket !== generation) return;
          set({ scopes: snapshot.scopes });
          if (get().dirty && !discardLocal) {
            if (snapshot.revision !== get().revision)
              set({
                error:
                  "Settings changed on another device. Reload saved settings to discard this device's draft.",
              });
          } else {
            set({ preferences: snapshot.preferences, revision: snapshot.revision, dirty: false });
            persist(get());
          }
        } catch (error) {
          if (ticket !== generation) return;
          if (
            error instanceof IntelligenceSettingsError &&
            error.status === 403 &&
            state.scope !== "personal"
          ) {
            await get().actions.setScope("personal");
            return;
          }
          set({ error: error instanceof Error ? error.message : "Settings sync failed." });
        } finally {
          if (ticket === generation) set({ loading: false });
        }
      },
      save: async () => {
        const state = get();
        if (state.loading || !state.dirty) return;
        if (state.userId === null) {
          set({ dirty: false });
          persist(get());
          return;
        }
        const ticket = ++generation;
        set({ loading: true, error: null });
        try {
          const snapshot: IntelligenceSnapshot = await dependencies.request(
            state.scope,
            {
              revision: state.revision,
              preferences: state.preferences,
            },
            state.userId,
          );
          if (ticket !== generation) return;
          set({
            revision: snapshot.revision,
            scopes: snapshot.scopes,
            dirty: get().preferences !== state.preferences,
          });
          persist(get());
        } catch (error) {
          if (ticket === generation)
            set({
              error:
                error instanceof Error
                  ? error.message
                  : "Settings sync failed. Your draft is saved on this device.",
            });
        } finally {
          if (ticket === generation) set({ loading: false });
        }
      },
    },
  }));
}

export const useIntelligenceSettingsStore = createSelectors(createIntelligenceSettingsStore());
