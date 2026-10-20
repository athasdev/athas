import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  chats: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
  outside: [{ agentId: "codex", sessionId: "t1", title: "CLI thread", updatedAt: new Date() }],
  status: { attention: null, working: true, workingCount: 1, attentionCount: 2 },
  git: {
    branch: "main",
    ahead: 2,
    behind: 0,
    files: [
      { path: "src/app.ts", status: "modified", staged: true },
      { path: "README.md", status: "untracked", staged: false },
    ],
  } as unknown,
}));

vi.mock("@/features/ai/hooks/use-sidebar-sessions", () => ({
  useSidebarSessions: () => ({
    byProject: { web: { projectId: "web", chats: state.chats, cloudRuns: [] } },
  }),
}));
vi.mock("@/features/ai/hooks/use-outside-agent-sessions", () => ({
  useOutsideAgentSessions: () => state.outside,
}));
vi.mock("@/features/ai/hooks/use-project-agent-status", () => ({
  useProjectAgentStatus: () => state.status,
}));
vi.mock("@/features/ai/components/sidebar/workbench-sessions", () => ({
  ProjectSessionList: ({ outside }: { outside: { title: string }[] }) => (
    <ul data-slot="session-list">{outside.map((session) => session.title)}</ul>
  ),
}));
vi.mock("@/features/layout/hooks/use-project-icon", () => ({ useProjectIcon: () => undefined }));
vi.mock("@/features/workspace/stores/workspace-tabs.store", () => ({
  useWorkspaceTabsStore: {
    use: { projectTabs: () => [{ id: "web", name: "web", path: "/code/web" }] },
  },
}));
vi.mock("@/features/git/stores/git.store", () => ({
  useGitStore: (select: (value: { workspaceGitStatus: unknown }) => unknown) =>
    select({ workspaceGitStatus: state.git }),
}));

import { ProjectDashboardView } from "../project-dashboard/components/project-dashboard-view";

const render = (projectPath = "/code/web") =>
  renderToStaticMarkup(<ProjectDashboardView projectPath={projectPath} />);

afterEach(() => {
  state.git = {
    branch: "main",
    ahead: 2,
    behind: 0,
    files: [
      { path: "src/app.ts", status: "modified", staged: true },
      { path: "README.md", status: "untracked", staged: false },
    ],
  };
});

describe("project dashboard", () => {
  it("sums up the project's sessions, branch and who needs the user", () => {
    const markup = render();
    expect(markup).toContain("3 sessions · 1 working · 2 need you");
    expect(markup).toContain("main");
    expect(markup).toContain("↑2");
    expect(markup).toContain("2 sessions waiting on you");
    expect(markup).toContain("CLI thread");
    expect(markup).toContain("New session");
  });

  it("lists uncommitted files with a way to review them, or says the tree is clean", () => {
    const markup = render();
    expect(markup).toContain("2 files · 1 staged");
    expect(markup).toContain("src/app.ts");
    expect(markup).toContain("Review");

    state.git = { branch: "main", ahead: 0, behind: 0, files: [] };
    const clean = render();
    expect(clean).toContain("Working tree clean");
    expect(clean).not.toContain("Review");
  });

  it("leaves out pull requests without a GitHub sign-in", () => {
    expect(render()).not.toContain("Pull requests");
  });

  it("says so when the project is not open", () => {
    expect(render("/code/other")).toContain("This project is not open.");
  });
});
