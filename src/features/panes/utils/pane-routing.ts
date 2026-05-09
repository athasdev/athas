import type { PaneGroup, PaneNode } from "../types/pane";
import { getAllPaneGroups } from "./pane-tree";

export interface WritablePaneRoutingInput {
  activePane: PaneGroup | null;
  bufferId?: string;
  bottomRoot: PaneNode;
  mostRecentActivePaneIds: string[];
  root: PaneNode;
}

export function getPaneScopeForPaneId(root: PaneNode, bottomRoot: PaneNode, paneId: string) {
  const rootPanes = getAllPaneGroups(root);
  if (rootPanes.some((pane) => pane.id === paneId)) {
    return rootPanes;
  }

  return getAllPaneGroups(bottomRoot);
}

export function resolveWritablePaneForBuffer({
  activePane,
  bufferId,
  bottomRoot,
  mostRecentActivePaneIds,
  root,
}: WritablePaneRoutingInput): PaneGroup | null {
  if (!activePane) return null;

  if ((bufferId && activePane.bufferIds.includes(bufferId)) || !activePane.locked) {
    return activePane;
  }

  const paneScope = getPaneScopeForPaneId(root, bottomRoot, activePane.id);
  const paneById = new Map(paneScope.map((pane) => [pane.id, pane] as const));
  return (
    mostRecentActivePaneIds
      .map((paneId) => paneById.get(paneId))
      .find((pane) => pane && pane.id !== activePane.id && !pane.locked) ??
    [...paneById.values()].find((pane) => pane.id !== activePane.id && !pane.locked) ??
    null
  );
}
