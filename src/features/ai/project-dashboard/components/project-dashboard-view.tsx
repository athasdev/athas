import { ProjectSessionList } from "@/features/ai/components/sidebar/workbench-sessions";
import { useOutsideAgentSessions } from "@/features/ai/hooks/use-outside-agent-sessions";
import { useProjectAgentStatus } from "@/features/ai/hooks/use-project-agent-status";
import { useSidebarSessions } from "@/features/ai/hooks/use-sidebar-sessions";
import { startAgentInProject } from "@/features/ai/services/agent-project-navigation";
import { useGitStore } from "@/features/git/stores/git.store";
import { useProjectIcon } from "@/features/layout/hooks/use-project-icon";
import { showProjectTool } from "@/features/layout/services/project-tools";
import { ProjectGlyph } from "@/features/workspace/project-icons/components/project-glyph";
import { areProjectTabPathsEqual } from "@/features/workspace/services/project-tab-path";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import { GroupedSection } from "@/ui/grouped-section";
import { FolderOpenIcon, GitBranchIcon, PlusIcon } from "@/ui/icons";
import { Workbench, WorkbenchContent } from "@/ui/workbench";
import { ProjectChangesSection } from "./project-changes-section";
import { ProjectPullRequestsSection } from "./project-pull-requests-section";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A project at a glance, for working with agents: who is working and who needs you, every
 * session (including ones run outside Athas), what is uncommitted, and the open pull requests.
 */
export function ProjectDashboardView({ projectPath }: { projectPath: string }) {
  const project = useWorkspaceTabsStore.use
    .projectTabs()
    .find((tab) => areProjectTabPathsEqual(tab.path, projectPath));
  const iconPath = useProjectIcon(projectPath, project?.customIcon);
  const sessions = useSidebarSessions().byProject[project?.id ?? ""];
  const outside = useOutsideAgentSessions(projectPath, Boolean(project));
  const chats = sessions?.chats ?? [];
  const { workingCount, attentionCount } = useProjectAgentStatus(chats);
  const git = useGitStore((state) => state.workspaceGitStatus);

  if (!project) {
    return (
      <Workbench>
        <Empty variant="region">
          <EmptyDescription>This project is not open.</EmptyDescription>
        </Empty>
      </Workbench>
    );
  }

  const summary = [
    plural(chats.length, "session"),
    workingCount > 0 ? `${workingCount} working` : null,
    attentionCount > 0 ? `${attentionCount} need${attentionCount === 1 ? "s" : ""} you` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasSessions = chats.length > 0 || outside.length > 0 || Boolean(sessions?.cloudRuns.length);

  return (
    <Workbench>
      <WorkbenchContent
        title={project.name}
        description={`${projectPath} · ${summary}`}
        leading={<ProjectGlyph projectPath={projectPath} iconPath={iconPath} />}
        status={
          git ? (
            <Badge>
              <GitBranchIcon />
              {git.branch}
              {git.ahead ? ` ↑${git.ahead}` : null}
              {git.behind ? ` ↓${git.behind}` : null}
            </Badge>
          ) : null
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => showProjectTool("files")}>
              <FolderOpenIcon />
              Files
            </Button>
            <Button variant="accent" onClick={() => void startAgentInProject(project.id)}>
              <PlusIcon />
              New session
            </Button>
          </>
        }
      >
        <div className="grid min-w-0 gap-6 @3xl/workbench-content:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <GroupedSection
            title="Sessions"
            description={
              attentionCount > 0 ? plural(attentionCount, "session") + " waiting on you" : undefined
            }
            variant="flat"
          >
            {hasSessions ? (
              <ProjectSessionList
                sessions={sessions}
                projectId={project.id}
                projectPath={projectPath}
                outside={outside}
              />
            ) : (
              <Empty variant="inline">
                <EmptyDescription>
                  No sessions yet. Start one to work on this project.
                </EmptyDescription>
              </Empty>
            )}
          </GroupedSection>
          <div className="flex min-w-0 flex-col gap-6">
            <ProjectChangesSection projectPath={projectPath} />
            <ProjectPullRequestsSection projectPath={projectPath} />
          </div>
        </div>
      </WorkbenchContent>
    </Workbench>
  );
}
