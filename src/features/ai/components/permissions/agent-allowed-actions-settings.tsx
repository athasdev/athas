import { useState } from "react";
import {
  getAllAllowedCommandPrefixes,
  removeAllowedCommandPrefix,
} from "@/features/ai/intelligence/services/intelligence-command-allowlist";
import {
  getAllowedMcpTools,
  removeAllowedMcpTool,
} from "@/features/ai/intelligence/services/intelligence-mcp-allowlist";
import Section, { SettingRow } from "@/features/settings/components/settings-section";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { TrashIcon } from "@/ui/icons";

interface AllowedAction {
  key: string;
  label: string;
  description: string;
  remove: () => void;
}

function readAllowedActions(serverNames: Map<string, string>): AllowedAction[] {
  const commands = Object.entries(getAllAllowedCommandPrefixes()).flatMap(([root, prefixes]) =>
    prefixes.map((prefix) => ({
      key: `command:${root}:${prefix}`,
      label: prefix,
      description: `Command prefix in ${root}`,
      remove: () => removeAllowedCommandPrefix(root, prefix),
    })),
  );
  const tools = Object.entries(getAllowedMcpTools()).flatMap(([serverId, names]) =>
    names.map((tool) => ({
      key: `mcp:${serverId}:${tool}`,
      label: tool,
      description: `MCP tool on ${serverNames.get(serverId) ?? "a removed server"}`,
      remove: () => removeAllowedMcpTool(serverId, tool),
    })),
  );
  return [...commands, ...tools];
}

/** What the built-in agent may run without asking, chosen with "Always allow". */
export function AgentAllowedActionsSettings() {
  const servers = useSettingsStore((state) => state.settings.mcpServers);
  const serverNames = new Map(servers.map((server) => [server.id, server.name]));
  const [, setRevision] = useState(0);
  const actions = readAllowedActions(serverNames);

  return (
    <Section title="Allowed Commands">
      {actions.length === 0 ? (
        <EmptyState variant="section" message="Nothing yet. Choose Always allow when asked." />
      ) : (
        actions.map((action) => (
          <SettingRow key={action.key} label={action.label} description={action.description}>
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              iconOnly
              tooltip="Remove"
              aria-label={`Stop always allowing ${action.label}`}
              onClick={() => {
                action.remove();
                setRevision((revision) => revision + 1);
              }}
            >
              <TrashIcon />
            </Button>
          </SettingRow>
        ))
      )}
    </Section>
  );
}
