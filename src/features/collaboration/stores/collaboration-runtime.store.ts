import { create } from "zustand";
import type {
  CollaborationDocumentSnapshot,
  CollaborationDocumentUpdate,
} from "@/features/window/services/auth-api";
import { createSelectors } from "@/utils/zustand-selectors";

type CollaborationStreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

interface CollaborationDocumentStreamState {
  status: CollaborationStreamStatus;
  path: string | null;
  documentId: number | null;
  lastServerVersion: number;
  updatesReceived: number;
  cursorUpdatesSent: number;
  viewportUpdatesSent: number;
  lastEventAt: string | null;
  error: string | null;
}

interface CollaborationPresenceTargetState {
  channelId: number | null;
  followingUserId: number | null;
}

interface CollaborationMediaState {
  microphone: boolean;
  screen: boolean;
}

interface CollaborationRemoteCursor {
  clientId: string;
  actorUserId: number | null;
  documentId: number;
  path: string | null;
  line: number;
  column: number;
  offset: number;
  activeChannelId: number | null;
  followingUserId: number | null;
  serverVersion: number;
  updatedAt: string | null;
}

interface CollaborationRemoteViewport {
  clientId: string;
  actorUserId: number | null;
  documentId: number;
  path: string | null;
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
  activeChannelId: number | null;
  followingUserId: number | null;
  serverVersion: number;
  updatedAt: string | null;
}

interface CollaborationRuntimeState {
  activeDocumentStream: CollaborationDocumentStreamState;
  presenceTarget: CollaborationPresenceTargetState;
  mediaState: CollaborationMediaState;
  remoteCursors: CollaborationRemoteCursor[];
  remoteViewports: CollaborationRemoteViewport[];
  actions: {
    setPresenceChannel: (channelId: number | null) => void;
    setFollowingUser: (userId: number | null) => void;
    setMicrophoneActive: (active: boolean) => void;
    setScreenShareActive: (active: boolean) => void;
    setStreamConnecting: (path: string) => void;
    setStreamReconnecting: () => void;
    setStreamReady: (document: CollaborationDocumentSnapshot, path: string) => void;
    recordStreamHeartbeat: (
      document: CollaborationDocumentSnapshot,
      afterServerVersion: number,
    ) => void;
    recordStreamUpdate: (
      document: CollaborationDocumentSnapshot,
      update: CollaborationDocumentUpdate,
      localClientId?: string,
    ) => void;
    recordCursorUpdateSent: (documentId: number) => void;
    recordViewportUpdateSent: (documentId: number) => void;
    setStreamError: (path: string | null, error: string) => void;
    resetStream: () => void;
  };
}

const initialActiveDocumentStream: CollaborationDocumentStreamState = {
  status: "idle",
  path: null,
  documentId: null,
  lastServerVersion: 0,
  updatesReceived: 0,
  cursorUpdatesSent: 0,
  viewportUpdatesSent: 0,
  lastEventAt: null,
  error: null,
};

const timestamp = () => new Date().toISOString();

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getCursorFromUpdate(
  update: CollaborationDocumentUpdate,
): CollaborationRemoteCursor | null {
  if (update.updateType !== "cursor") return null;

  const operation = update.operation;
  const cursor = operation.cursor;
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;

  const cursorRecord = cursor as Record<string, unknown>;
  const line = getNumber(cursorRecord.line);
  const column = getNumber(cursorRecord.column);
  const offset = getNumber(cursorRecord.offset);
  if (line === null || column === null || offset === null) return null;

  return {
    clientId: update.clientId,
    actorUserId: update.actorUserId,
    documentId: update.documentId,
    path: typeof operation.path === "string" ? operation.path : null,
    line,
    column,
    offset,
    activeChannelId: getNumber(operation.activeChannelId),
    followingUserId: getNumber(operation.followingUserId),
    serverVersion: update.serverVersion,
    updatedAt: update.createdAt,
  };
}

function getViewportFromUpdate(
  update: CollaborationDocumentUpdate,
): CollaborationRemoteViewport | null {
  if (update.updateType !== "metadata" || update.operation.source !== "desktop-viewport") {
    return null;
  }

  const viewport = update.operation.viewport;
  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) return null;

  const viewportRecord = viewport as Record<string, unknown>;
  const scrollTop = getNumber(viewportRecord.scrollTop);
  const scrollLeft = getNumber(viewportRecord.scrollLeft);
  const viewportHeight = getNumber(viewportRecord.viewportHeight);
  if (scrollTop === null || scrollLeft === null || viewportHeight === null) return null;

  return {
    clientId: update.clientId,
    actorUserId: update.actorUserId,
    documentId: update.documentId,
    path: typeof update.operation.path === "string" ? update.operation.path : null,
    scrollTop,
    scrollLeft,
    viewportHeight,
    activeChannelId: getNumber(update.operation.activeChannelId),
    followingUserId: getNumber(update.operation.followingUserId),
    serverVersion: update.serverVersion,
    updatedAt: update.createdAt,
  };
}

export const useCollaborationRuntimeStore = createSelectors(
  create<CollaborationRuntimeState>((set) => ({
    activeDocumentStream: initialActiveDocumentStream,
    presenceTarget: {
      channelId: null,
      followingUserId: null,
    },
    mediaState: {
      microphone: false,
      screen: false,
    },
    remoteCursors: [],
    remoteViewports: [],
    actions: {
      setPresenceChannel: (channelId) =>
        set((state) => ({
          presenceTarget: {
            ...state.presenceTarget,
            channelId,
          },
        })),
      setFollowingUser: (userId) =>
        set((state) => ({
          presenceTarget: {
            ...state.presenceTarget,
            followingUserId: userId,
          },
        })),
      setMicrophoneActive: (active) =>
        set((state) => ({
          mediaState: {
            ...state.mediaState,
            microphone: active,
          },
        })),
      setScreenShareActive: (active) =>
        set((state) => ({
          mediaState: {
            ...state.mediaState,
            screen: active,
          },
        })),
      setStreamConnecting: (path) =>
        set(() => ({
          activeDocumentStream: {
            ...initialActiveDocumentStream,
            status: "connecting",
            path,
            lastEventAt: timestamp(),
          },
          remoteCursors: [],
          remoteViewports: [],
        })),
      setStreamReconnecting: () =>
        set((state) => ({
          activeDocumentStream: {
            ...state.activeDocumentStream,
            status: "reconnecting",
            lastEventAt: timestamp(),
          },
        })),
      setStreamReady: (document, path) =>
        set((state) => ({
          activeDocumentStream: {
            ...state.activeDocumentStream,
            status: "live",
            path,
            documentId: document.id,
            lastServerVersion: document.baseVersion,
            lastEventAt: timestamp(),
            error: null,
          },
        })),
      recordStreamHeartbeat: (document, afterServerVersion) =>
        set((state) => ({
          activeDocumentStream: {
            ...state.activeDocumentStream,
            status: "live",
            documentId: document.id,
            lastServerVersion: Math.max(
              state.activeDocumentStream.lastServerVersion,
              afterServerVersion,
              document.baseVersion,
            ),
            lastEventAt: timestamp(),
            error: null,
          },
        })),
      recordStreamUpdate: (document, update, localClientId) =>
        set((state) => {
          const cursor = update.clientId === localClientId ? null : getCursorFromUpdate(update);
          const viewport = update.clientId === localClientId ? null : getViewportFromUpdate(update);
          const remoteCursors = cursor
            ? [
                cursor,
                ...state.remoteCursors.filter((entry) => entry.clientId !== cursor.clientId),
              ].slice(0, 20)
            : state.remoteCursors;
          const remoteViewports = viewport
            ? [
                viewport,
                ...state.remoteViewports.filter((entry) => entry.clientId !== viewport.clientId),
              ].slice(0, 20)
            : state.remoteViewports;

          return {
            activeDocumentStream: {
              ...state.activeDocumentStream,
              status: "live",
              documentId: document.id,
              lastServerVersion: Math.max(
                state.activeDocumentStream.lastServerVersion,
                update.serverVersion,
                document.baseVersion,
              ),
              updatesReceived: state.activeDocumentStream.updatesReceived + 1,
              lastEventAt: timestamp(),
              error: null,
            },
            remoteCursors,
            remoteViewports,
          };
        }),
      recordCursorUpdateSent: (documentId) =>
        set((state) => ({
          activeDocumentStream: {
            ...state.activeDocumentStream,
            documentId,
            cursorUpdatesSent: state.activeDocumentStream.cursorUpdatesSent + 1,
            lastEventAt: timestamp(),
          },
        })),
      recordViewportUpdateSent: (documentId) =>
        set((state) => ({
          activeDocumentStream: {
            ...state.activeDocumentStream,
            documentId,
            viewportUpdatesSent: state.activeDocumentStream.viewportUpdatesSent + 1,
            lastEventAt: timestamp(),
          },
        })),
      setStreamError: (path, error) =>
        set((state) => ({
          activeDocumentStream: {
            ...state.activeDocumentStream,
            status: "error",
            path,
            lastEventAt: timestamp(),
            error,
          },
        })),
      resetStream: () =>
        set(() => ({
          activeDocumentStream: initialActiveDocumentStream,
          remoteCursors: [],
          remoteViewports: [],
        })),
    },
  })),
);
