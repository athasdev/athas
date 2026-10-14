import { useState } from "react";
import { startGitHubWork } from "@/features/ai/services/start-github-work";
import { GitHubWorkSuggestions } from "@/features/github/components/github-work-suggestions";
import { useGitHubRepoPath } from "@/features/github/hooks/use-github-repo-path";
import { isRemoteProjectPath } from "@/features/workspace/services/project-tab-path";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { AgentLaunchInput } from "./agent-launch-input";
import { AgentProjectPicker } from "./agent-project-picker";
import { AgentStartView } from "./agent-start-view";

/**
 * A new tab: the agent start screen with its launch input, a picker for the open project the agent
 * starts in, and the project's open pull requests and issues to start from.
 */
export function NewTabView({ surfaceId, autoFocus }: { surfaceId: string; autoFocus?: boolean }) {
  const activeWorkspaceId = useActiveWorkspaceId();
  const ownProjectId = useWorkspaceStoreScopeId() ?? activeWorkspaceId;
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const ownRepoPath = useGitHubRepoPath();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);

  const ownProject = projectTabs.find((project) => project.id === ownProjectId) ?? null;
  const targetProject = projectTabs.find((project) => project.id === pickedProjectId) ?? ownProject;
  const otherProjectId =
    targetProject && targetProject.id !== ownProjectId ? targetProject.id : null;
  const repoPath = otherProjectId ? (targetProject?.path ?? null) : ownRepoPath;
  const suggestionsRepoPath = repoPath && !isRemoteProjectPath(repoPath) ? repoPath : null;

  return (
    <AgentStartView
      showQuickActions
      header={
        targetProject && projectTabs.length > 1 ? (
          <AgentProjectPicker
            projects={projectTabs}
            value={targetProject}
            onChange={setPickedProjectId}
          />
        ) : null
      }
      footer={
        <GitHubWorkSuggestions
          repoPath={suggestionsRepoPath}
          onStart={(item) => {
            if (suggestionsRepoPath)
              void startGitHubWork(otherProjectId, suggestionsRepoPath, item);
          }}
        />
      }
    >
      <AgentLaunchInput
        autoFocus={autoFocus}
        surfaceId={surfaceId}
        targetProjectId={otherProjectId}
      />
    </AgentStartView>
  );
}
