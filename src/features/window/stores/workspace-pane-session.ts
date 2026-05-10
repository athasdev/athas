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

const unique = <T>(items: T[]) => Array.from(new Set(items));

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

  const bufferPaths = unique(
    node.bufferIds
      .map((bufferId) => bufferPathById.get(bufferId))
      .filter((path): path is string => !!path),
  );
  const bufferPathSet = new Set(bufferPaths);
  const activeBufferPathCandidate = node.activeBufferId
    ? (bufferPathById.get(node.activeBufferId) ?? null)
    : null;
  const activeBufferPath =
    activeBufferPathCandidate && bufferPathSet.has(activeBufferPathCandidate)
      ? activeBufferPathCandidate
      : null;
  const mruBufferPaths = unique(
    (node.mruBufferIds ?? [])
      .map((bufferId) => bufferPathById.get(bufferId))
      .filter((path): path is string => !!path && bufferPathSet.has(path)),
  );
  const pinnedBufferPaths = unique(
    (node.pinnedBufferIds ?? [])
      .map((bufferId) => bufferPathById.get(bufferId))
      .filter((path): path is string => !!path && bufferPathSet.has(path)),
  );
  const previewBufferPathCandidate = node.previewBufferId
    ? (bufferPathById.get(node.previewBufferId) ?? null)
    : null;
  const previewBufferPath =
    previewBufferPathCandidate && bufferPathSet.has(previewBufferPathCandidate)
      ? previewBufferPathCandidate
      : null;

  return {
    id: node.id,
    type: "group",
    bufferPaths,
    activeBufferPath,
    mruBufferPaths,
    previewBufferPath,
    pinnedBufferPaths,
    locked: node.locked,
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

  const bufferIds = unique(
    node.bufferPaths
      .map((path) => bufferIdByPath.get(path))
      .filter((bufferId): bufferId is string => !!bufferId),
  );
  const bufferIdSet = new Set(bufferIds);
  const activeBufferId = node.activeBufferPath
    ? (bufferIdByPath.get(node.activeBufferPath) ?? null)
    : null;
  const mruBufferIds = unique(
    (node.mruBufferPaths ?? [])
      .map((path) => bufferIdByPath.get(path))
      .filter((bufferId): bufferId is string => !!bufferId && bufferIdSet.has(bufferId)),
  );
  const pinnedBufferIds = unique(
    (node.pinnedBufferPaths ?? [])
      .map((path) => bufferIdByPath.get(path))
      .filter((bufferId): bufferId is string => !!bufferId && bufferIdSet.has(bufferId)),
  );
  const previewBufferId = node.previewBufferPath
    ? (bufferIdByPath.get(node.previewBufferPath) ?? null)
    : null;

  return {
    id: node.id,
    type: "group",
    bufferIds,
    activeBufferId: activeBufferId && bufferIds.includes(activeBufferId) ? activeBufferId : null,
    mruBufferIds,
    previewBufferId:
      previewBufferId && bufferIds.includes(previewBufferId) ? previewBufferId : null,
    pinnedBufferIds,
    locked: node.locked,
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
    mostRecentActivePaneIds: layout.mostRecentActivePaneIds,
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
      mostRecentActivePaneIds: [ROOT_PANE_ID],
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
    mostRecentActivePaneIds: paneState.mostRecentActivePaneIds,
    fullscreenPaneId: paneState.fullscreenPaneId,
  };
};
