import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { createSelectors } from "@/utils/zustand-selectors";
import type { UpdateInfo } from "../hooks/use-updater";
import {
  hydrateWhatsNew,
  queuePendingWhatsNew,
  resolveWhatsNewInfo,
  storeCurrentWhatsNew,
  type WhatsNewInfo,
} from "../lib/whats-new";

interface WhatsNewState {
  initialized: boolean;
  info: WhatsNewInfo | null;
  actions: {
    initialize: () => Promise<void>;
    open: () => Promise<void>;
    openInfo: (info: WhatsNewInfo) => Promise<void>;
    queuePendingUpdate: (updateInfo: UpdateInfo) => void;
  };
}

function openWhatsNewSurface(info: WhatsNewInfo) {
  useBufferStore.getState().actions.openOnboardingBuffer({
    mode: "release-notes",
    currentVersion: info.version,
    previousVersion: info.previousVersion,
  });
}

const useWhatsNewStoreBase = create<WhatsNewState>()((set, get) => ({
  initialized: false,
  info: null,

  actions: {
    initialize: async () => {
      if (get().initialized) {
        return;
      }

      const currentVersion = await getVersion();
      const info = hydrateWhatsNew(currentVersion);
      const resolvedInfo = await resolveWhatsNewInfo(info);
      storeCurrentWhatsNew(resolvedInfo);

      set({
        initialized: true,
        info: resolvedInfo,
      });
    },

    open: async () => {
      if (!get().initialized) {
        await get().actions.initialize();
      }

      const info = get().info;
      if (!info) {
        return;
      }

      const resolvedInfo = await resolveWhatsNewInfo(info);
      storeCurrentWhatsNew(resolvedInfo);
      set({ info: resolvedInfo });
      openWhatsNewSurface(resolvedInfo);
    },

    openInfo: async (info) => {
      const resolvedInfo = await resolveWhatsNewInfo(info);
      set({ info: resolvedInfo });
      openWhatsNewSurface(resolvedInfo);
    },

    queuePendingUpdate: (updateInfo) => {
      queuePendingWhatsNew({
        version: updateInfo.version,
        previousVersion: updateInfo.currentVersion,
        body: updateInfo.body,
        date: updateInfo.date,
      });
    },
  },
}));

export const useWhatsNewStore = createSelectors(useWhatsNewStoreBase);
