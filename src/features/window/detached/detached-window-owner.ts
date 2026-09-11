import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import {
  type DetachedWindowBaseMessage,
  type DetachedWindowKind,
  getDetachedWindowChannelName,
} from "./detached-window-protocol";

const INITIALIZE_TIMEOUT_MS = 30_000;

export interface DetachedWindowHandle<Message> {
  readonly id: string;
  /** Resolves once the native window exists, or once creation has failed. Never rejects. */
  opened: Promise<void>;
  post: (message: Message) => void;
  /** Call once the child has taken over its content, so a slow start no longer counts as a failure. */
  markInitialized: () => void;
  /** Close the native window outright. */
  destroy: () => Promise<void>;
}

export interface OpenDetachedWindowOptions<Message> {
  kind: DetachedWindowKind;
  /** Serialized content the window opens by itself, without waiting for a message. */
  payload?: string;
  /** Messages the base protocol does not handle itself. */
  onMessage: (message: Message, handle: DetachedWindowHandle<Message>) => void;
  /** The native window went away: closed by the user, crashed, or torn down after a timeout. */
  onDestroyed: (context: { initialized: boolean }) => void;
  /** The native window could not be created. Nothing was shown. */
  onError: (error: unknown) => void;
  /** The child never initialized in time. The window has already been destroyed. */
  onOpenTimeout: () => void;
}

function focusOwnerWindow() {
  void getCurrentWindow().setFocus().catch(console.error);
}

/**
 * Owner side of a detached window. Creates the channel synchronously so the
 * caller can register the handle before the native window exists, then opens
 * the window and wires up the shared lifecycle: "workbench" and "settings"
 * requests land in this window, a child that never initializes is torn down,
 * and the channel is released exactly once.
 */
export function openDetachedWindow<Message extends { type: string }>(
  options: OpenDetachedWindowOptions<Message>,
): DetachedWindowHandle<Message> {
  const id = crypto.randomUUID();
  const channel = new BroadcastChannel(getDetachedWindowChannelName(id));
  let initialized = false;
  let released = false;
  let native: Window | undefined;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    unlisten?.();
    channel.close();
  };

  const handle: DetachedWindowHandle<Message> = {
    id,
    opened: Promise.resolve(),
    post: (message) => {
      if (!released) channel.postMessage(message);
    },
    markInitialized: () => {
      initialized = true;
      clearTimeout(timer);
    },
    destroy: async () => {
      await native?.destroy();
    },
  };

  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    if (released) return;
    const base = data as DetachedWindowBaseMessage;
    if (base.type === "workbench") {
      useBufferStore.getState().actions.openContent(base.content);
      focusOwnerWindow();
      return;
    }
    if (base.type === "settings") {
      useUIState.getState().openSettingsDialog(base.tab, base.section);
      focusOwnerWindow();
      return;
    }
    options.onMessage(data, handle);
  };

  const open = async () => {
    try {
      const label = await createAppWindow({
        detached:
          options.payload === undefined
            ? { kind: options.kind, channel: id }
            : { kind: options.kind, channel: id, payload: options.payload },
      });
      native = new Window(label);
      unlisten = await native.once("tauri://destroyed", () => {
        if (released) return;
        const wasInitialized = initialized;
        release();
        options.onDestroyed({ initialized: wasInitialized });
      });
      if (!initialized) {
        timer = setTimeout(() => {
          if (initialized || released) return;
          void native!
            .destroy()
            .then(() => {
              release();
              options.onOpenTimeout();
            })
            .catch((error) => {
              release();
              options.onError(error);
            });
        }, INITIALIZE_TIMEOUT_MS);
      }
    } catch (error) {
      if (native) {
        try {
          await native.destroy();
        } catch (closeError) {
          release();
          options.onError(closeError);
          return;
        }
      }
      release();
      options.onError(error);
    }
  };

  handle.opened = open();
  return handle;
}
