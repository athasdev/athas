export type ActivitySidebarSectionId = "agents" | "terminals";

export function isActivitySidebarSectionCollapsed(
  collapsedSectionIds: string[],
  sectionId: ActivitySidebarSectionId,
) {
  return collapsedSectionIds.includes(sectionId);
}

export function toggleActivitySidebarSection(
  collapsedSectionIds: string[],
  sectionId: ActivitySidebarSectionId,
) {
  return isActivitySidebarSectionCollapsed(collapsedSectionIds, sectionId)
    ? collapsedSectionIds.filter((collapsedSectionId) => collapsedSectionId !== sectionId)
    : [...collapsedSectionIds, sectionId];
}
