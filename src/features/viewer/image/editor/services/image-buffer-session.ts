import type { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { showToast } from "@/utils/toast";
import { ImageEditSession } from "./image-edit-session";
import { saveImageToFile } from "../utils/image-file-utils";

export interface ImageBufferOwner {
  workspaceId: string;
  store: ReturnType<typeof useBufferStore.getStore>;
}
const sessions = new WeakMap<ImageBufferOwner["store"], Map<string, ImageEditSession>>();
const saves = new WeakMap<ImageEditSession, Promise<boolean>>();
let saveQueue: Promise<unknown> = Promise.resolve();
function isOwnerLive(owner: ImageBufferOwner) {
  return (
    workspaceRuntimeRegistry.getWorkspace(owner.workspaceId)?.stores.get("editor-buffer") ===
    owner.store
  );
}
export function getImageBufferSession(
  owner: ImageBufferOwner,
  bufferId: string,
): ImageEditSession | null {
  if (!isOwnerLive(owner)) return null;
  const buffer = owner.store.getState().buffers.find((item) => item.id === bufferId);
  if (buffer?.type !== "image") return null;
  let owned = sessions.get(owner.store);
  if (!owned) {
    owned = new Map();
    sessions.set(owner.store, owned);
  }
  const existing = owned.get(bufferId);
  if (existing) return existing;
  const path = buffer.path;
  const isCurrent = () =>
    isOwnerLive(owner) &&
    owner.store
      .getState()
      .buffers.some((item) => item.id === bufferId && item.type === "image" && item.path === path);
  const session = new ImageEditSession(isCurrent, buffer.imageDraft);
  owned.set(bufferId, session);
  const unsubscribeSession = session.subscribe(() => {
    if (isCurrent())
      owner.store.getState().actions.updateImageDraft(bufferId, session.getSnapshot());
  });
  const unsubscribeStore = owner.store.subscribe(() => {
    if (isCurrent()) return;
    session.dispose();
    owned.delete(bufferId);
    unsubscribeSession();
    unsubscribeStore();
  });
  return session;
}
export function saveImageBufferById(owner: ImageBufferOwner, bufferId: string): Promise<boolean> {
  const session = getImageBufferSession(owner, bufferId);
  if (!session) return Promise.resolve(false);
  const pending = saves.get(session);
  if (pending) return pending;
  const snapshot = session.captureSave();
  const buffer = owner.store.getState().buffers.find((item) => item.id === bufferId);
  if (!snapshot || !buffer) return Promise.resolve(false);
  const task = saveQueue
    .then(async () => {
      if (!session.isSaveCurrent(snapshot)) return false;
      const saved = await saveImageToFile(snapshot.source, buffer.name, {
        isCurrent: () => session.isSaveCurrent(snapshot),
        onError: (message) => showToast({ message, type: "error" }),
      });
      return saved && session.markSaved(snapshot);
    })
    .catch((error) => {
      if (session.isSaveCurrent(snapshot)) showToast({ message: String(error), type: "error" });
      return false;
    })
    .finally(() => {
      if (saves.get(session) === task) saves.delete(session);
    });
  saveQueue = task;
  saves.set(session, task);
  return task;
}
