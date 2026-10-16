import { useEffect } from "react";
import { openCustomize } from "@/features/ai/customize/services/open-customize";
import type { CustomizeSection } from "@/features/ai/customize/types/customize.types";
import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import Section, { SettingRow } from "../settings-section";

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function OpenCustomizeButton({ section }: { section: CustomizeSection }) {
  return (
    <Button variant="outline" onClick={() => openCustomize(section)}>
      Open Customize
    </Button>
  );
}

/** Settings > AI > MCP servers: how many there are, and the way to Customize, which edits them. */
export function McpServersSummarySection() {
  const servers = useSettingsStore((state) => state.settings.mcpServers);
  const enabled = servers.filter((server) => server.enabled).length;

  return (
    <Section title="MCP Servers">
      <SettingRow
        label="MCP servers"
        description={
          servers.length === 0
            ? "Add servers from the catalog or by hand in Customize"
            : `${plural(servers.length, "server")}, ${enabled} passed to agents`
        }
      >
        <OpenCustomizeButton section="mcp" />
      </SettingRow>
    </Section>
  );
}

/** Settings > AI > Agents: installed agents and skills, managed in Customize. */
export function AgentsSummarySection() {
  const agents = useAgentCatalogStore.use.agents();
  const codex = useAgentCatalogStore.use.codex();
  const refresh = useAgentCatalogStore.use.actions().refresh;
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const installedAgents =
    (agents.data?.filter((agent) => agent.installed).length ?? 0) + (codex.data?.installed ? 1 : 0);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Section title="Agents">
      <SettingRow
        label="Agents"
        description={`${plural(installedAgents, "agent")} installed, including Codex and the ACP Registry`}
      >
        <OpenCustomizeButton section="agents" />
      </SettingRow>
      <SettingRow
        label="Skills"
        description={`${plural(skills.length, "skill")} to hand to agents`}
      >
        <OpenCustomizeButton section="skills" />
      </SettingRow>
    </Section>
  );
}
