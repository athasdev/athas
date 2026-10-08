import { type ComponentType, use } from "react";
import type { CodeMirrorHost } from "../engines/codemirror/host";

/**
 * What other features contribute to the code editor. A feature registers a loader once from its
 * registration module, run by each window that shows editors before it renders; the loader
 * imports the contribution on demand, so its code stays out of the startup bundle and loads with
 * the first editor (`code-editor.tsx` starts the load when its chunk is evaluated). Loaders are
 * keyed by a stable id, so a module that runs again (hot reload) replaces its loader.
 *
 * CodeMirror features install their extensions in the order they render, and that order is their
 * precedence. Every feature, built in or contributed, mounts in one commit once the contributions
 * have loaded, so a contributed feature always takes its slot's place in that order:
 *
 * - `overlays`: decorations and overlays over the text (agent edit hunks, the selection toolbar,
 *   inline edit), after inline blame and before the hover tooltips, minimap and sticky scroll.
 * - `completion`: suggestions while typing, last, after the language server features.
 */

export type CodeMirrorFeatureSlot = "overlays" | "completion";

export type CodeMirrorFeature = ComponentType<{ host: CodeMirrorHost }>;

export interface EditorFeatureContribution {
  codeMirror?: Partial<Record<CodeMirrorFeatureSlot, CodeMirrorFeature[]>>;
  /** Controls in the editor toolbar's status actions, shown for text editor buffers. */
  statusActions?: ComponentType[];
}

type EditorFeatureLoader = () => Promise<EditorFeatureContribution>;

const NO_CONTRIBUTIONS: EditorFeatureContribution[] = [];
const loaders = new Map<string, EditorFeatureLoader>();
let loadedContributions: EditorFeatureContribution[] | null = null;
let loadingContributions: Promise<EditorFeatureContribution[]> | null = null;

export function registerEditorFeatures(id: string, load: EditorFeatureLoader) {
  if (loaders.get(id) === load) return;
  loaders.set(id, load);
  loadedContributions = null;
  loadingContributions = null;
}

/** Loads every registered contribution; a contribution that fails to load is left out. */
export function loadEditorFeatures(): Promise<EditorFeatureContribution[]> {
  if (loadingContributions) return loadingContributions;
  const loading = Promise.all(
    [...loaders.values()].map((load) =>
      load().catch((error: unknown) => {
        console.error("Failed to load an editor feature contribution:", error);
        return {};
      }),
    ),
  ).then((contributions) => {
    if (loadingContributions === loading) loadedContributions = contributions;
    return contributions;
  });
  loadingContributions = loading;
  return loading;
}

/** The loaded contributions; suspends until they have loaded. */
export function useEditorFeatures(): EditorFeatureContribution[] {
  if (loaders.size === 0) return NO_CONTRIBUTIONS;
  return loadedContributions ?? use(loadEditorFeatures());
}

export function getCodeMirrorFeatures(
  contributions: EditorFeatureContribution[],
  slot: CodeMirrorFeatureSlot,
): CodeMirrorFeature[] {
  return contributions.flatMap((contribution) => contribution.codeMirror?.[slot] ?? []);
}
