import { TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export type NativeDragDropPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

interface RawDragDropPayload {
  paths?: string[];
  position?: { x: number; y: number };
}

/**
 * Tauri's unlisten runs an injected script that reads `listeners[eventId].handlerId`.
 * When the listener was registered moments earlier, the script that stores that entry
 * may not have run yet, so the unlisten promise rejects with a TypeError. The listener
 * is already gone on the Rust side by then, so the rejection is safe to drop.
 */
export function safeUnlisten(unlisten: UnlistenFn) {
  try {
    const result: unknown = unlisten();
    if (result instanceof Promise) {
      result.catch(() => undefined);
    }
  } catch {
    // Same race as above, thrown synchronously by a non-async unlisten.
  }
}

/**
 * Removes a listener that `listen` is still registering or already registered. Neither a failed
 * `listen` nor the unlisten race above can then surface as an unhandled rejection.
 */
export function disposeListener(listener: Promise<UnlistenFn>) {
  listener.then(safeUnlisten, () => undefined);
}

function toPosition(position: RawDragDropPayload["position"]) {
  return { x: position?.x ?? 0, y: position?.y ?? 0 };
}

/**
 * Subscribe to native drag-and-drop events on the current webview.
 *
 * Unlike `getCurrentWebview().onDragDropEvent`, the returned disposer never lets an
 * unlisten rejection escape, and listeners registered before a failure are removed.
 * A webview window receives drag events addressed to its label, so listening on the
 * webview alone covers both webview windows and child webviews without handling each
 * drop twice.
 */
export async function listenToNativeDragDrop(
  handler: (payload: NativeDragDropPayload) => void,
): Promise<() => void> {
  const webview = getCurrentWebview();
  const unlisteners: UnlistenFn[] = [];
  const dispose = () => {
    for (const unlisten of unlisteners.splice(0)) safeUnlisten(unlisten);
  };

  try {
    unlisteners.push(
      await webview.listen<RawDragDropPayload>(TauriEvent.DRAG_ENTER, ({ payload }) =>
        handler({
          type: "enter",
          paths: payload.paths ?? [],
          position: toPosition(payload.position),
        }),
      ),
    );
    unlisteners.push(
      await webview.listen<RawDragDropPayload>(TauriEvent.DRAG_OVER, ({ payload }) =>
        handler({ type: "over", position: toPosition(payload.position) }),
      ),
    );
    unlisteners.push(
      await webview.listen<RawDragDropPayload>(TauriEvent.DRAG_DROP, ({ payload }) =>
        handler({
          type: "drop",
          paths: payload.paths ?? [],
          position: toPosition(payload.position),
        }),
      ),
    );
    unlisteners.push(await webview.listen(TauriEvent.DRAG_LEAVE, () => handler({ type: "leave" })));
  } catch (error) {
    dispose();
    throw error;
  }

  return dispose;
}
