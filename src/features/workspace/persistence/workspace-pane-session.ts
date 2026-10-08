import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "@/features/panes/constants/pane";
import type { PaneLayoutSnapshot } from "@/features/panes/stores/pane.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { PaneGroup, PaneNode, PaneSplit } from "@/features/panes/types/pane.types";
import { findPaneGroup, getAllPaneGroups } from "@/features/panes/services/pane-tree";
import {
  PROJECT_PANE_SESSION_VERSION,
  type ProjectPaneSession,
  type ProjectPaneSessionNode,
} from "@/features/workspace/stores/session.store";

/** Tab state the restored buffers already carry, merged into the saved layout. */
export interface PaneLayoutRestoreOptions {
  activeBufferId?: string | null;
  pinnedBufferIds?: ReadonlySet<string>;
  previewBufferIds?: ReadonlySet<string>;
  /** Saved buffer paths in their old global tab order, for sessions older than version 2. */
  legacyTabOrder?: readonly string[];
}

const createEmptyPaneNode = (id: string): PaneGroup => ({
  id,
  type: "group",
  bufferIds: [],
  activeBufferId: null,
});

const isPersistablePaneBuffer = (buffer: PaneContent) =>
  (buffer.type === "editor" && !buffer.isVirtual) ||
  buffer.type === "terminal" ||
  buffer.type === "browser";

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
    activeBufferId: activeBufferId && bufferIdSet.has(activeBufferId) ? activeBufferId : null,
    mruBufferIds,
    previewBufferId: previewBufferId && bufferIdSet.has(previewBufferId) ? previewBufferId : null,
    pinnedBufferIds,
    locked: node.locked,
  };
};

const addBuffersToPaneNode = (
  node: PaneNode,
  paneId: string,
  bufferIds: string[],
  setActiveWhenEmpty: boolean,
): PaneNode => {
  if (node.type === "split") {
    return {
      ...node,
      children: [
        addBuffersToPaneNode(node.children[0], paneId, bufferIds, setActiveWhenEmpty),
        addBuffersToPaneNode(node.children[1], paneId, bufferIds, setActiveWhenEmpty),
      ],
    };
  }

  if (node.id !== paneId) {
    return node;
  }

  const nextBufferIds = unique([...node.bufferIds, ...bufferIds]);
  const shouldSetActive = setActiveWhenEmpty && !node.activeBufferId && node.bufferIds.length === 0;
  const activeBufferId = shouldSetActive ? (bufferIds[0] ?? null) : node.activeBufferId;
  const nextBufferIdSet = new Set(nextBufferIds);

  return {
    ...node,
    bufferIds: nextBufferIds,
    activeBufferId,
    mruBufferIds: unique([
      ...(activeBufferId ? [activeBufferId] : []),
      ...(node.mruBufferIds ?? []),
      ...nextBufferIds,
    ]).filter((bufferId) => nextBufferIdSet.has(bufferId)),
  };
};

const attachMissingBuffersToLayout = (
  layout: PaneLayoutSnapshot,
  buffers: PaneContent[],
  activeBufferId: string | null | undefined,
): PaneLayoutSnapshot => {
  const persistableBufferIds = buffers.filter(isPersistablePaneBuffer).map((buffer) => buffer.id);
  if (persistableBufferIds.length === 0) {
    return layout;
  }

  const paneBufferIds = new Set(
    [...getAllPaneGroups(layout.root), ...getAllPaneGroups(layout.bottomRoot)].flatMap(
      (pane) => pane.bufferIds,
    ),
  );
  const missingBufferIds = persistableBufferIds.filter((bufferId) => !paneBufferIds.has(bufferId));
  if (missingBufferIds.length === 0) {
    return layout;
  }

  const missingBufferIdSet = new Set(missingBufferIds);
  const orderedMissingBufferIds =
    activeBufferId && missingBufferIdSet.has(activeBufferId)
      ? [activeBufferId, ...missingBufferIds.filter((bufferId) => bufferId !== activeBufferId)]
      : missingBufferIds;
  const targetPaneId = findPaneGroup(layout.root, layout.activePaneId)
    ? layout.activePaneId
    : ROOT_PANE_ID;

  return {
    ...layout,
    root: addBuffersToPaneNode(layout.root, targetPaneId, orderedMissingBufferIds, true),
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
    version: PROJECT_PANE_SESSION_VERSION,
    root: serializePaneNode(layout.root, bufferPathById),
    bottomRoot: serializePaneNode(layout.bottomRoot, bufferPathById),
    activePaneId: layout.activePaneId,
    mostRecentActivePaneIds: layout.mostRecentActivePaneIds,
    fullscreenPaneId: layout.fullscreenPaneId,
  };
};

/**
 * Folds in tab state the restored buffers carry: pins (sessions before version 2 could hold a pin
 * only on the buffer), the old global tab order and previews for those older sessions.
 */
const applyRestoredTabState = (
  node: PaneNode,
  options: PaneLayoutRestoreOptions,
  isLegacySession: boolean,
  bufferPathById: Map<string, string>,
): PaneNode => {
  if (node.type === "split") {
    return {
      ...node,
      children: [
        applyRestoredTabState(node.children[0], options, isLegacySession, bufferPathById),
        applyRestoredTabState(node.children[1], options, isLegacySession, bufferPathById),
      ],
    };
  }

  let bufferIds = node.bufferIds;
  if (isLegacySession && options.legacyTabOrder) {
    const rankByPath = new Map(options.legacyTabOrder.map((path, index) => [path, index] as const));
    const rank = (bufferId: string) =>
      rankByPath.get(bufferPathById.get(bufferId) ?? "") ?? Number.MAX_SAFE_INTEGER;
    bufferIds = [...bufferIds].sort((left, right) => rank(left) - rank(right));
  }

  const pinnedBufferIds = unique([
    ...(node.pinnedBufferIds ?? []),
    ...bufferIds.filter((bufferId) => options.pinnedBufferIds?.has(bufferId)),
  ]);
  let previewBufferId = node.previewBufferId ?? null;
  if (!previewBufferId && isLegacySession) {
    previewBufferId = bufferIds.find((bufferId) => options.previewBufferIds?.has(bufferId)) ?? null;
  }
  if (previewBufferId && pinnedBufferIds.includes(previewBufferId)) {
    previewBufferId = null;
  }

  return { ...node, bufferIds, pinnedBufferIds, previewBufferId };
};

const applyRestoredTabStateToLayout = (
  layout: PaneLayoutSnapshot,
  buffers: PaneContent[],
  options: PaneLayoutRestoreOptions,
  isLegacySession: boolean,
): PaneLayoutSnapshot => {
  const bufferPathById = new Map(buffers.map((buffer) => [buffer.id, buffer.path] as const));
  return {
    ...layout,
    root: applyRestoredTabState(layout.root, options, isLegacySession, bufferPathById),
    bottomRoot: applyRestoredTabState(layout.bottomRoot, options, isLegacySession, bufferPathById),
  };
};

export const buildPaneLayoutFromSession = (
  paneState: ProjectPaneSession | null | undefined,
  buffers: PaneContent[],
  options: PaneLayoutRestoreOptions = {},
): PaneLayoutSnapshot => {
  const isLegacySession = (paneState?.version ?? 1) < PROJECT_PANE_SESSION_VERSION;
  if (!paneState) {
    return applyRestoredTabStateToLayout(
      attachMissingBuffersToLayout(
        {
          root: createEmptyPaneNode(ROOT_PANE_ID),
          bottomRoot: createEmptyPaneNode(BOTTOM_PANE_ID),
          activePaneId: ROOT_PANE_ID,
          mostRecentActivePaneIds: [ROOT_PANE_ID],
          fullscreenPaneId: null,
        },
        buffers,
        options.activeBufferId,
      ),
      buffers,
      options,
      isLegacySession,
    );
  }

  const bufferIdByPath = new Map(
    buffers.filter(isPersistablePaneBuffer).map((buffer) => [buffer.path, buffer.id] as const),
  );

  return applyRestoredTabStateToLayout(
    attachMissingBuffersToLayout(
      {
        root: hydratePaneNode(paneState.root, bufferIdByPath),
        bottomRoot: hydratePaneNode(paneState.bottomRoot, bufferIdByPath),
        activePaneId: paneState.activePaneId,
        mostRecentActivePaneIds: paneState.mostRecentActivePaneIds,
        fullscreenPaneId: paneState.fullscreenPaneId,
      },
      buffers,
      options.activeBufferId,
    ),
    buffers,
    options,
    isLegacySession,
  );
};
