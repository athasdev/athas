import { useCallback, useEffect, useState } from "react";
import { createMcpServerDraft, splitMcpServerDraft } from "@/features/ai/services/mcp-servers";
import { parseMcpInstallLink } from "@/features/ai/services/mcp-install-link";
import {
  getMcpServerSecrets,
  removeMcpServerSecrets,
  storeMcpServerSecrets,
} from "@/features/ai/services/mcp-server-secrets";
import type { McpServerDraft, McpServerSetting } from "@/features/ai/types/mcp-server.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { usePendingMcpInstallLinkStore } from "@/features/window/stores/pending-mcp-install-link.store";
import { showConfirmDialog } from "@/ui/dialog";
import { useToast } from "@/utils/toast";

export interface McpServerEditorState {
  draft: McpServerDraft;
  /** What the user still has to fill in, for a server added from the catalog. */
  notice?: string;
}

/**
 * Adding, editing, switching and removing MCP servers. Settings keep the server, secure storage
 * keeps its environment variables and headers. An `athas://mcp/install` link waiting in the
 * pending store opens the dialog with its server, and `onInstallLink` brings the page forward.
 */
export function useMcpServerEditor(onInstallLink?: () => void) {
  const servers = useSettingsStore((state) => state.settings.mcpServers);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { showToast } = useToast();
  const [editor, setEditor] = useState<McpServerEditorState | null>(null);
  const pendingInstallLink = usePendingMcpInstallLinkStore.use.url();

  useEffect(() => {
    if (!pendingInstallLink) return;
    usePendingMcpInstallLinkStore.getState().actions.clear();
    onInstallLink?.();
    const installDraft = parseMcpInstallLink(new URL(pendingInstallLink));
    if (installDraft) {
      setEditor({ draft: installDraft });
    } else {
      showToast({ message: "This MCP server link is not valid", type: "error" });
    }
  }, [onInstallLink, pendingInstallLink, showToast]);

  const saveServers = useCallback(
    (next: McpServerSetting[]) => updateSetting("mcpServers", next),
    [updateSetting],
  );

  const openNew = useCallback((draft = createMcpServerDraft(), notice?: string) => {
    setEditor({ draft, notice });
  }, []);

  const openEdit = useCallback(
    async (server: McpServerSetting) => {
      try {
        setEditor({ draft: createMcpServerDraft(server, await getMcpServerSecrets(server.id)) });
      } catch {
        showToast({ message: `Could not read the saved values for ${server.name}`, type: "error" });
      }
    },
    [showToast],
  );

  const save = useCallback(
    async (nextDraft: McpServerDraft) => {
      const id = nextDraft.id ?? crypto.randomUUID();
      const { server, secrets } = splitMcpServerDraft(nextDraft, id);
      try {
        await storeMcpServerSecrets(id, secrets);
      } catch {
        showToast({ message: `Could not save the values for ${server.name}`, type: "error" });
        return;
      }
      const current = useSettingsStore.getState().settings.mcpServers;
      await saveServers(
        nextDraft.id
          ? current.map((existing) => (existing.id === id ? server : existing))
          : [...current, server],
      );
      setEditor(null);
    },
    [saveServers, showToast],
  );

  const remove = useCallback(
    async (server: McpServerSetting) => {
      const confirmed = await showConfirmDialog(
        `Remove ${server.name}? Agents started after this will no longer get it.`,
        { title: "Remove MCP server", confirmLabel: "Remove", destructive: true },
      );
      if (!confirmed) return;

      await saveServers(
        useSettingsStore.getState().settings.mcpServers.filter((item) => item.id !== server.id),
      );
      try {
        await removeMcpServerSecrets(server.id);
      } catch {
        showToast({
          message: `Could not remove the saved values for ${server.name}`,
          type: "error",
        });
      }
    },
    [saveServers, showToast],
  );

  const setEnabled = useCallback(
    (server: McpServerSetting, enabled: boolean) =>
      saveServers(
        useSettingsStore
          .getState()
          .settings.mcpServers.map((item) => (item.id === server.id ? { ...item, enabled } : item)),
      ),
    [saveServers],
  );

  return {
    servers,
    editor,
    openNew,
    openEdit,
    save,
    remove,
    setEnabled,
    close: () => setEditor(null),
  };
}
