import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { UpdateInfo } from "../hooks/use-updater";
import {
  buildWhatsNewMarkdown,
  hydrateWhatsNew,
  queuePendingWhatsNew,
  resolveWhatsNewInfo,
  storeCurrentWhatsNew,
  type WhatsNewInfo,
} from "../lib/whats-new";

interface WhatsNewState {
  initialized: boolean;
  info: WhatsNewInfo | null;
  initialize: () => Promise<void>;
  open: () => Promise<void>;
  openInfo: (info: WhatsNewInfo) => Promise<void>;
  queuePendingUpdate: (updateInfo: UpdateInfo) => void;
}

function openWhatsNewBuffer(info: WhatsNewInfo) {
  const path = `whats-new://v${info.version}`;
  const name = "What's New";
  const content = buildWhatsNewMarkdown(info);

  useBufferStore
    .getState()
    .actions.openBuffer(path, name, content, false, undefined, false, true, undefined, true);
}

export const useWhatsNewStore = create<WhatsNewState>()((set, get) => ({
  initialized: false,
  info: null,

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const currentVersion = await getVersion();
    const { info, shouldAutoOpen } = hydrateWhatsNew(currentVersion);
    const resolvedInfo = await resolveWhatsNewInfo(info);
    storeCurrentWhatsNew(resolvedInfo);

    set({
      initialized: true,
      info: resolvedInfo,
    });

    if (shouldAutoOpen) {
      openWhatsNewBuffer(resolvedInfo);
    }
  },

  open: async () => {
    if (!get().initialized) {
      await get().initialize();
    }

    const info = get().info;
    if (!info) {
      return;
    }

    const resolvedInfo = await resolveWhatsNewInfo(info);
    storeCurrentWhatsNew(resolvedInfo);
    set({ info: resolvedInfo });
    openWhatsNewBuffer(resolvedInfo);
  },

  openInfo: async (info) => {
    const resolvedInfo = await resolveWhatsNewInfo(info);
    openWhatsNewBuffer(resolvedInfo);
  },

  queuePendingUpdate: (updateInfo) => {
    queuePendingWhatsNew({
      version: updateInfo.version,
      previousVersion: updateInfo.currentVersion,
      body: updateInfo.body,
      date: updateInfo.date,
    });
  },
}));
