import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import { getBaseName, stripTrailingPathSeparators } from "@/utils/path-helpers";
import { readTeamWorkspaceContent, saveTeamWorkspace } from "../services/team-workspace-service";
import { createTeamWorkspace, parseTeamWorkspace } from "../utils/team-workspace-config";
import type { TeamWorkspace } from "../types/team-workspace";

export type WorkspaceSection =
  | "overview"
  | "repositories"
  | "environments"
  | "tasks"
  | "ai"
  | "extensions";
export interface WorkspaceDraft {
  config: TeamWorkspace;
  original: string | null;
  saved: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}
interface WorkspaceManagementState {
  roots: string[];
  selectedRoot: string | null;
  section: WorkspaceSection;
  bindings: Record<string, Record<string, string>>;
  drafts: Record<string, WorkspaceDraft>;
  actions: {
    register: (path: string) => void;
    select: (path: string) => void;
    setSection: (section: WorkspaceSection) => void;
    bindRepository: (root: string, id: string, path: string) => void;
    load: (root: string, reload?: boolean) => Promise<void>;
    update: (root: string, config: TeamWorkspace) => void;
    save: (root: string) => Promise<void>;
  };
}

export const useWorkspaceManagementStore = createSelectors(
  create<WorkspaceManagementState>()(
    persist(
      (set, get) => ({
        roots: [],
        selectedRoot: null,
        section: "overview",
        bindings: {},
        drafts: {},
        actions: {
          register: (path) => {
            const root = stripTrailingPathSeparators(path);
            if (!root) return;
            set((state) => ({
              roots: state.roots.includes(root) ? state.roots : [...state.roots, root],
              selectedRoot: root,
            }));
          },
          select: (selectedRoot) => set({ selectedRoot }),
          setSection: (section) => set({ section }),
          bindRepository: (root, id, path) =>
            set((state) => ({
              bindings: { ...state.bindings, [root]: { ...state.bindings[root], [id]: path } },
            })),
          load: async (root, reload = false) => {
            const existing = get().drafts[root];
            if (existing?.loading || existing?.saving || (existing && !reload)) return;
            const config = existing?.config ?? createTeamWorkspace(getBaseName(root));
            set((state) => ({
              drafts: {
                ...state.drafts,
                [root]: {
                  config,
                  original: existing?.original ?? null,
                  saved: existing?.saved ?? JSON.stringify(config),
                  loading: true,
                  saving: false,
                  error: null,
                },
              },
            }));
            try {
              const original = await readTeamWorkspaceContent(root);
              const config =
                original === null
                  ? createTeamWorkspace(getBaseName(root))
                  : parseTeamWorkspace(original);
              set((state) => ({
                drafts: {
                  ...state.drafts,
                  [root]: {
                    config,
                    original,
                    saved: JSON.stringify(config),
                    loading: false,
                    saving: false,
                    error: null,
                  },
                },
              }));
            } catch (error) {
              set((state) => ({
                drafts: {
                  ...state.drafts,
                  [root]: {
                    ...state.drafts[root]!,
                    loading: false,
                    error: error instanceof Error ? error.message : "Could not read workspace.",
                  },
                },
              }));
            }
          },
          update: (root, config) =>
            set((state) => {
              const draft = state.drafts[root];
              if (!draft || draft.loading || draft.saving) return state;
              return { drafts: { ...state.drafts, [root]: { ...draft, config } } };
            }),
          save: async (root) => {
            const draft = get().drafts[root];
            if (!draft || draft.loading || draft.saving) return;
            set((state) => ({
              drafts: { ...state.drafts, [root]: { ...draft, saving: true, error: null } },
            }));
            try {
              const config = parseTeamWorkspace(JSON.stringify(draft.config));
              await saveTeamWorkspace(root, config, draft.original);
              const original = `${JSON.stringify(config, null, 2)}\n`;
              set((state) => ({
                drafts: {
                  ...state.drafts,
                  [root]: {
                    config,
                    original,
                    saved: JSON.stringify(config),
                    loading: false,
                    saving: false,
                    error: null,
                  },
                },
              }));
            } catch (error) {
              set((state) => ({
                drafts: {
                  ...state.drafts,
                  [root]: {
                    ...state.drafts[root]!,
                    saving: false,
                    error: error instanceof Error ? error.message : "Could not save workspace.",
                  },
                },
              }));
            }
          },
        },
      }),
      {
        name: "athas-workspace-management",
        storage: createSafeJSONStorage(),
        partialize: ({ roots, selectedRoot, section, bindings }) => ({
          roots,
          selectedRoot,
          section,
          bindings,
        }),
      },
    ),
  ),
);
