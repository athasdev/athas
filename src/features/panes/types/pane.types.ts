export interface PaneGroup {
  id: string;
  type: "group";
  bufferIds: string[];
  activeBufferId: string | null;
  mruBufferIds?: string[];
  previewBufferId?: string | null;
  pinnedBufferIds?: string[];
  locked?: boolean;
}

export interface PaneSplit {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  children: [PaneNode, PaneNode];
  sizes: [number, number];
}

export type PaneNode = PaneGroup | PaneSplit;

export type SplitDirection = "horizontal" | "vertical";
export type SplitPlacement = "before" | "after";

export interface PaneState {
  root: PaneNode;
  activePaneId: string;
  mostRecentActivePaneIds?: string[];
  fullscreenPaneId?: string | null;
}
