import { createProjectTabId, normalizeProjectTabPath } from "./project-tab-path";

interface PersistedProjectTab {
  id: string;
  path: string;
  isActive: boolean;
}

/**
 * Tabs saved before root paths were normalized may carry a repeated separator. Their path and the
 * id derived from it are brought to the current form so opening the same folder finds the tab.
 * Tabs that end up with the same id merge into the first one, which stays active if any was.
 */
export const normalizePersistedProjectTabs = <T extends PersistedProjectTab>(tabs: T[]): T[] => {
  const normalizedTabs: T[] = [];
  const indexById = new Map<string, number>();
  for (const tab of tabs) {
    const path = normalizeProjectTabPath(tab.path);
    const id = path === tab.path ? tab.id : createProjectTabId(path);
    const existingIndex = indexById.get(id);
    if (existingIndex !== undefined) {
      const existing = normalizedTabs[existingIndex];
      if (tab.isActive && !existing.isActive) {
        normalizedTabs[existingIndex] = { ...existing, isActive: true };
      }
      continue;
    }
    indexById.set(id, normalizedTabs.length);
    normalizedTabs.push(path === tab.path ? tab : { ...tab, id, path });
  }
  return normalizedTabs;
};
