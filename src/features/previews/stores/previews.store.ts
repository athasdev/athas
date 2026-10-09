import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { tauriFetch } from "@/utils/tauri-fetch";
import { createSelectors } from "@/utils/zustand-selectors";
import type { Preview, PreviewTunnelStatus } from "../types/previews.types";
import { isValidPort, type ProxyFetch } from "../services/preview-proxy";
import {
  connectPreviewTunnel,
  PreviewEndedError,
  type PreviewTunnelConnection,
} from "../services/preview-tunnel";
import {
  createLocalPreview,
  PreviewsError,
  refreshPreviewTicket,
  stopPreview as stopPreviewOnServer,
} from "../services/previews-api";

/** A local server this window shares, with its tunnel's state and the requests it answered. */
export interface SharedLocalPreview {
  preview: Preview;
  status: PreviewTunnelStatus;
  requests: number;
}

interface PreviewsState {
  isDialogOpen: boolean;
  shared: Record<string, SharedLocalPreview>;
  actions: {
    openDialog: () => void;
    closeDialog: () => void;
    /** Creates a preview of `http://localhost:<port>` and keeps its tunnel open. */
    shareLocalServer: (port: number) => Promise<Preview>;
    /** Stops a preview, local or sandbox, and closes its tunnel when this window runs it. */
    stopPreview: (id: string) => Promise<void>;
    /** Stops every preview this window shares, for signing out and quitting. */
    stopAll: () => Promise<void>;
  };
}

const tunnels = new Map<string, PreviewTunnelConnection>();

export const previewsStoreDependencies = {
  fetch: tauriFetch as ProxyFetch,
  connectPreviewTunnel,
};

export const usePreviewsStore = createSelectors(
  create<PreviewsState>()(
    immer((set, get) => {
      const closeTunnel = (id: string) => {
        tunnels.get(id)?.close();
        tunnels.delete(id);
      };

      return {
        isDialogOpen: false,
        shared: {},
        actions: {
          openDialog: () => set({ isDialogOpen: true }),
          closeDialog: () => set({ isDialogOpen: false }),

          shareLocalServer: async (port) => {
            if (!isValidPort(port))
              throw new PreviewsError("Enter a port between 1 and 65535.", 400);
            const { preview, connect } = await createLocalPreview(port);
            set((state) => {
              state.shared[preview.id] = { preview, status: "connecting", requests: 0 };
            });
            const tunnel = previewsStoreDependencies.connectPreviewTunnel({
              port,
              ticket: connect,
              fetch: previewsStoreDependencies.fetch,
              requestTicket: async () => {
                try {
                  return await refreshPreviewTicket(preview.id);
                } catch (error) {
                  if (
                    error instanceof PreviewsError &&
                    (error.status === 404 || error.status === 410)
                  )
                    throw new PreviewEndedError(error.message);
                  throw error;
                }
              },
              onStatus: (status) => {
                // An ended tunnel (stopped elsewhere or expired) leaves the list.
                if (status === "ended") tunnels.delete(preview.id);
                set((state) => {
                  if (status === "ended") delete state.shared[preview.id];
                  else if (state.shared[preview.id]) state.shared[preview.id]!.status = status;
                });
              },
              onRequest: () =>
                set((state) => {
                  const entry = state.shared[preview.id];
                  if (entry) entry.requests += 1;
                }),
            });
            tunnels.set(preview.id, tunnel);
            return preview;
          },

          stopPreview: async (id) => {
            closeTunnel(id);
            set((state) => {
              const entry = state.shared[id];
              if (entry) entry.status = "ended";
            });
            try {
              await stopPreviewOnServer(id);
            } finally {
              set((state) => {
                delete state.shared[id];
              });
            }
          },

          stopAll: async () => {
            const ids = Object.keys(get().shared);
            for (const id of ids) closeTunnel(id);
            await Promise.allSettled(ids.map((id) => stopPreviewOnServer(id)));
            set((state) => {
              state.shared = {};
            });
          },
        },
      };
    }),
  ),
);

/** Closes this window's tunnels without asking the account service, for when the page unloads. */
export function closeAllPreviewTunnels() {
  for (const tunnel of tunnels.values()) tunnel.close();
  tunnels.clear();
}
