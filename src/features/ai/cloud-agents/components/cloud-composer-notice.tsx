import { useAgentDisplayNames } from "@/features/ai/hooks/use-agent-display-names";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import { CloudWarningIcon, WarningIcon } from "@/ui/icons";
import type { AgentEnvironment } from "../hooks/use-agent-environment";
import type { CloudTargets } from "../hooks/use-cloud-targets";
import { CloudAgentsError } from "../services/cloud-agents-api";
import { DEFAULT_CLOUD_AGENT_ID, toCloudAgentId } from "../services/cloud-environment";
import { openCloudProblemPage } from "../services/cloud-problem-actions";

function errorCode(error: unknown) {
  return error instanceof CloudAgentsError ? error.code : undefined;
}

/**
 * What stands between a Cloud composer and a run it can start: an agent that only runs locally,
 * GitHub not connected, or no repository to run in.
 */
export function CloudComposerNotice({
  environment,
  targets,
  currentAgentId,
  onAgentChange,
}: {
  environment: AgentEnvironment;
  targets: CloudTargets;
  currentAgentId: AgentType;
  onAgentChange?: (agentId: AgentType) => void;
}) {
  const { hasCloudAgents } = useProFeature();
  const { getName } = useAgentDisplayNames();
  if (!hasCloudAgents || environment.kind !== "cloud" || environment.locked) return null;

  let notice: {
    id: string;
    icon: typeof WarningIcon;
    title: string;
    description: string;
    action?: { label: string; run: () => void };
  } | null = null;

  if (!toCloudAgentId(currentAgentId)) {
    notice = {
      id: "agent",
      icon: WarningIcon,
      title: "Cloud runs use Claude Code or Codex",
      description: `${currentAgentId === "custom" ? "This model" : getName(currentAgentId)} only runs on this machine.`,
      action: onAgentChange
        ? { label: "Use Claude Code", run: () => onAgentChange(DEFAULT_CLOUD_AGENT_ID) }
        : undefined,
    };
  } else if (
    errorCode(targets.reposError) === "github_not_connected" ||
    errorCode(targets.branchesError) === "github_not_connected"
  ) {
    notice = {
      id: "github",
      icon: CloudWarningIcon,
      title: "Connect GitHub",
      description: "Cloud agents clone your repository and open a pull request through GitHub.",
      action: { label: "Connect GitHub", run: () => openCloudProblemPage("connect-github") },
    };
  } else if (
    !environment.repo &&
    targets.projectRepoResolved &&
    !targets.reposLoading &&
    !targets.projectRepo
  ) {
    notice = {
      id: "repo",
      icon: CloudWarningIcon,
      title: "Choose a repository",
      description: "This project has no GitHub remote. Pick the repository the agent clones.",
    };
  }

  if (!notice) return null;
  const Icon = notice.icon;
  return (
    <div className="px-1.5 pt-1.5">
      <Alert
        tone="warning"
        variant="inset"
        role="status"
        aria-live="polite"
        data-notice-id={`cloud-${notice.id}`}
      >
        <Icon />
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription>{notice.description}</AlertDescription>
        {notice.action ? (
          <AlertActions>
            <Button type="button" size="xs" onClick={notice.action.run}>
              {notice.action.label}
            </Button>
          </AlertActions>
        ) : null}
      </Alert>
    </div>
  );
}
