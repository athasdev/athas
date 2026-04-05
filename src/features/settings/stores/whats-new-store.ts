import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { UpdateInfo } from "../hooks/use-updater";
import { hydrateWhatsNew, queuePendingWhatsNew, type WhatsNewInfo } from "../lib/whats-new";

interface WhatsNewState {
  initialized: boolean;
  info: WhatsNewInfo | null;
  initialize: () => Promise<void>;
  open: () => Promise<void>;
  queuePendingUpdate: (updateInfo: UpdateInfo) => void;
}

function buildWhatsNewMarkdown(info: WhatsNewInfo): string {
  const lines = [`# What's New in Athas ${info.version}`, ""];

  if (info.previousVersion) {
    lines.push(`Updated from \`${info.previousVersion}\`.`, "");
  }

  if (info.date) {
    lines.push(`Released: ${info.date}`, "");
  }

  if (info.body?.trim()) {
    lines.push(info.body.trim(), "");
  } else {
    lines.push("Release notes were not bundled with this update.", "");
  }

  lines.push("---");
  lines.push(
    `[View release on GitHub](https://github.com/athasdev/athas/releases/tag/v${info.version})`,
  );

  return lines.join("\n");
}

function openWhatsNewBuffer(info: WhatsNewInfo) {
  const path = `whats-new://v${info.version}.md`;
  const name = `What's New ${info.version}.md`;
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

    set({
      initialized: true,
      info,
    });

    if (shouldAutoOpen) {
      openWhatsNewBuffer(info);
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

    openWhatsNewBuffer(info);
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
