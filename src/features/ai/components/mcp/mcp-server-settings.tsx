import { useState } from "react";
import { McpServerDialog } from "@/features/ai/components/mcp/mcp-server-dialog";
import {
  createMcpServerDraft,
  describeMcpServer,
  MCP_TRANSPORT_LABELS,
  splitMcpServerDraft,
} from "@/features/ai/lib/mcp-servers";
import {
  getMcpServerSecrets,
  removeMcpServerSecrets,
  storeMcpServerSecrets,
} from "@/features/ai/services/mcp-server-secrets";
import type { McpServerDraft, McpServerSetting } from "@/features/ai/types/mcp-server.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import Section, { SettingRow } from "@/features/settings/components/settings-section";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { PencilIcon, PlusIcon, TrashIcon } from "@/ui/icons";
import Switch from "@/ui/switch";

export function McpServerSettings() {
  const servers = useSettingsStore((state) => state.settings.mcpServers);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { showToast } = useToast();
  const [draft, setDraft] = useState<McpServerDraft | null>(null);

  const saveServers = (next: McpServerSetting[]) => updateSetting("mcpServers", next);

  const openEditor = async (server?: McpServerSetting) => {
    if (!server) {
      setDraft(createMcpServerDraft());
      return;
    }
    try {
      setDraft(createMcpServerDraft(server, await getMcpServerSecrets(server.id)));
    } catch {
      showToast({ message: `Could not read the saved values for ${server.name}`, type: "error" });
    }
  };

  const handleSave = async (nextDraft: McpServerDraft) => {
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
    setDraft(null);
  };

  const handleRemove = async (server: McpServerSetting) => {
    const confirmed = await showConfirmDialog(
      `Remove ${server.name}? Agents started after this will no longer get it.`,
      { title: "Remove MCP server", confirmLabel: "Remove" },
    );
    if (!confirmed) return;

    await saveServers(
      useSettingsStore.getState().settings.mcpServers.filter((item) => item.id !== server.id),
    );
    try {
      await removeMcpServerSecrets(server.id);
    } catch {
      showToast({ message: `Could not remove the saved values for ${server.name}`, type: "error" });
    }
  };

  const handleToggle = (server: McpServerSetting, enabled: boolean) => {
    void saveServers(
      useSettingsStore
        .getState()
        .settings.mcpServers.map((item) => (item.id === server.id ? { ...item, enabled } : item)),
    );
  };

  return (
    <>
      <Section
        title="MCP Servers"
        description="Passed to ACP agents when a session starts. Changes apply to the next agent start."
      >
        {servers.map((server) => (
          <SettingRow
            key={server.id}
            label={server.name}
            description={`${MCP_TRANSPORT_LABELS[server.transport]} · ${describeMcpServer(server)}`}
          >
            <div className="flex items-center gap-1">
              <Switch
                checked={server.enabled}
                onChange={(enabled) => handleToggle(server, enabled)}
                aria-label={`Pass ${server.name} to agents`}
              />
              <Button
                type="button"
                variant="ghost"
                iconOnly
                tooltip="Edit"
                aria-label={`Edit ${server.name}`}
                onClick={() => void openEditor(server)}
              >
                <PencilIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                tone="danger"
                iconOnly
                tooltip="Remove"
                aria-label={`Remove ${server.name}`}
                onClick={() => void handleRemove(server)}
              >
                <TrashIcon />
              </Button>
            </div>
          </SettingRow>
        ))}
        <SettingRow
          label="Add MCP server"
          description="Run a local command over stdio, or connect to an HTTP or SSE server"
        >
          <Button type="button" variant="default" onClick={() => void openEditor()}>
            <PlusIcon />
            <span>Add server</span>
          </Button>
        </SettingRow>
      </Section>
      {draft ? (
        <McpServerDialog
          initialDraft={draft}
          servers={servers}
          onClose={() => setDraft(null)}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}
