export interface ClosableProjectTab {
  id: string;
  isActive: boolean;
}

export function removeProjectTabItems<T extends ClosableProjectTab>(
  tabs: T[],
  projectId: string,
): T[] {
  const tabIndex = tabs.findIndex((tab) => tab.id === projectId);
  if (tabIndex === -1) {
    return tabs;
  }

  const wasActive = tabs[tabIndex].isActive;
  const remainingTabs = tabs.filter((tab) => tab.id !== projectId);

  if (!wasActive || remainingTabs.length === 0) {
    return remainingTabs;
  }

  const nextActiveIndex = Math.max(0, tabIndex - 1);
  const nextActiveId = remainingTabs[nextActiveIndex]?.id;

  return remainingTabs.map((tab) => ({
    ...tab,
    isActive: tab.id === nextActiveId,
  }));
}
