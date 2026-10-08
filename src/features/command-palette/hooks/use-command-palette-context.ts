import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getAgentCli } from "@/features/ai/services/agent-clis";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/stores/buffer-index";
import {
  selectBrowseSessionsAgentId,
  selectCurrentAgentId,
  selectLogOutAgentId,
} from "@/features/keymaps/commands/agent-command-context";
import type { CommandContext } from "@/features/keymaps/types/keymaps.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

/** The command context, kept current while the palette is open. */
export function useCommandPaletteContext(): CommandContext {
  const settings = useSettingsStore((state) => state.settings);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const activeBufferId = useActiveBufferId();
  const activeBuffer = useBufferStore(
    useShallow((state) => {
      const buffer = activeBufferId ? getBufferById(state.buffers, activeBufferId) : undefined;
      if (!buffer) return null;
      return {
        id: buffer.id,
        type: buffer.type,
        path: buffer.path,
        isVirtual: buffer.type === "editor" && buffer.isVirtual === true,
        isMarkdownPreview: buffer.type === "editor" && buffer.isMarkdownPreview === true,
      };
    }),
  );
  const lspStatus = useLspStore.use.lspStatus();
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const currentAgentId = useAIChatStore(selectCurrentAgentId);
  const logOutAgentId = useAIChatStore((state) => selectLogOutAgentId(state, rootFolderPath));
  const browseSessionsAgentId = useAIChatStore((state) =>
    selectBrowseSessionsAgentId(state, rootFolderPath),
  );

  return useMemo(
    () => ({
      settings,
      ui: { isSidebarVisible, isBottomPaneVisible, bottomPaneActiveTab },
      activeBuffer,
      lspStatus,
      agent: { cli: getAgentCli(currentAgentId), logOutAgentId, browseSessionsAgentId },
    }),
    [
      settings,
      isSidebarVisible,
      isBottomPaneVisible,
      bottomPaneActiveTab,
      activeBuffer,
      lspStatus,
      currentAgentId,
      logOutAgentId,
      browseSessionsAgentId,
    ],
  );
}
