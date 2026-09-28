import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import type { AgentOption } from "@/features/ai/lib/agent-options";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { ArrowClockwiseIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import Section, { SettingRow, SettingStatus } from "../settings-section";

function AgentStatus({ agent }: { agent: AgentOption }) {
  if (agent.isInstalled) return <Badge tone="success">Installed</Badge>;
  return <Badge>Not installed</Badge>;
}

/**
 * Coding agents made by other companies that Athas can run, such as Codex or Claude Code. They
 * sign in with their own accounts and pick their own models.
 */
export function AgentsSection() {
  const { options, isLoading, loadError, refresh, runAgentAction } = useAgentOptions("custom");
  const agents = options.filter((agent) => agent.id !== "custom");

  return (
    <Section title="Agents">
      {agents.map((agent) => {
        const action = agent.action;
        return (
          <SettingRow
            key={agent.id}
            label={agent.name}
            labelAccessory={<AgentStatus agent={agent} />}
            description={agent.description}
            activateOnClick={false}
          >
            {agent.isBusy ? (
              <Spinner compact label={action === "update" ? "Updating" : "Installing"} />
            ) : action ? (
              <Button onClick={() => void runAgentAction(agent.id, agent.name, action)}>
                {action === "update" ? "Update" : "Install"}
              </Button>
            ) : null}
          </SettingRow>
        );
      })}
      {isLoading ? (
        <SettingRow label="Looking for agents" activateOnClick={false}>
          <Spinner compact label="Loading agents" />
        </SettingRow>
      ) : null}
      {loadError ? (
        <SettingRow
          label="Could not load agents"
          description={<SettingStatus tone="danger">{loadError}</SettingStatus>}
        >
          <Button onClick={() => void refresh()}>
            <ArrowClockwiseIcon />
            <span>Try again</span>
          </Button>
        </SettingRow>
      ) : null}
    </Section>
  );
}
