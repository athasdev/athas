export interface PaneGroup {
  id: string;
  type: "group";
  bufferIds: string[];
  activeBufferId: string | null;
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

export interface PaneState {
  root: PaneNode;
  activePaneId: string;
}
