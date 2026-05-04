import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "@/features/panes/constants/pane";
import type { PaneLayoutSnapshot } from "@/features/panes/stores/pane-store";
import type { PaneContent } from "@/features/panes/types/pane-content";
import type { PaneGroup, PaneNode, PaneSplit } from "@/features/panes/types/pane";
import type {
  ProjectPaneSession,
  ProjectPaneSessionNode,
} from "@/features/window/stores/session-store";

export const createEmptyPaneNode = (id: string): PaneGroup => ({
  id,
  type: "group",
  bufferIds: [],
  activeBufferId: null,
});

const isPersistablePaneBuffer = (buffer: PaneContent) =>
  (buffer.type === "editor" && !buffer.isVirtual) ||
  buffer.type === "terminal" ||
  buffer.type === "webViewer";

const serializePaneNode = (
  node: PaneNode,
  bufferPathById: Map<string, string>,
): ProjectPaneSessionNode => {
  if (node.type === "split") {
    return {
      id: node.id,
      type: "split",
      direction: node.direction,
      sizes: node.sizes,
      children: [
        serializePaneNode(node.children[0], bufferPathById),
        serializePaneNode(node.children[1], bufferPathById),
      ],
    };
  }

  const bufferPaths = node.bufferIds
    .map((bufferId) => bufferPathById.get(bufferId))
    .filter((path): path is string => !!path);
  const activeBufferPath = node.activeBufferId
    ? (bufferPathById.get(node.activeBufferId) ?? null)
    : null;

  return {
    id: node.id,
    type: "group",
    bufferPaths,
    activeBufferPath,
  };
};

const hydratePaneNode = (
  node: ProjectPaneSessionNode,
  bufferIdByPath: Map<string, string>,
): PaneNode => {
  if (node.type === "split") {
    return {
      id: node.id,
      type: "split",
      direction: node.direction,
      sizes: node.sizes,
      children: [
        hydratePaneNode(node.children[0], bufferIdByPath),
        hydratePaneNode(node.children[1], bufferIdByPath),
      ],
    } satisfies PaneSplit;
  }

  const bufferIds = node.bufferPaths
    .map((path) => bufferIdByPath.get(path))
    .filter((bufferId): bufferId is string => !!bufferId);
  const activeBufferId = node.activeBufferPath
    ? (bufferIdByPath.get(node.activeBufferPath) ?? null)
    : null;

  return {
    id: node.id,
    type: "group",
    bufferIds,
    activeBufferId: activeBufferId && bufferIds.includes(activeBufferId) ? activeBufferId : null,
  };
};

export const buildCurrentProjectPaneSession = (
  layout: PaneLayoutSnapshot,
  buffers: PaneContent[],
): ProjectPaneSession => {
  const bufferPathById = new Map(
    buffers.filter(isPersistablePaneBuffer).map((buffer) => [buffer.id, buffer.path] as const),
  );

  return {
    root: serializePaneNode(layout.root, bufferPathById),
    bottomRoot: serializePaneNode(layout.bottomRoot, bufferPathById),
    activePaneId: layout.activePaneId,
    fullscreenPaneId: layout.fullscreenPaneId,
  };
};

export const buildPaneLayoutFromSession = (
  paneState: ProjectPaneSession | null | undefined,
  buffers: PaneContent[],
): PaneLayoutSnapshot => {
  if (!paneState) {
    return {
      root: createEmptyPaneNode(ROOT_PANE_ID),
      bottomRoot: createEmptyPaneNode(BOTTOM_PANE_ID),
      activePaneId: ROOT_PANE_ID,
      fullscreenPaneId: null,
    };
  }

  const bufferIdByPath = new Map(
    buffers.filter(isPersistablePaneBuffer).map((buffer) => [buffer.path, buffer.id] as const),
  );

  return {
    root: hydratePaneNode(paneState.root, bufferIdByPath),
    bottomRoot: hydratePaneNode(paneState.bottomRoot, bufferIdByPath),
    activePaneId: paneState.activePaneId,
    fullscreenPaneId: paneState.fullscreenPaneId,
  };
};
