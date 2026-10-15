import { describe, expect, it } from "vite-plus/test";
import { parseChatSessionSettings } from "@/features/ai/lib/chat-session-settings";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import type { CloudAgentRun } from "../services/cloud-agents-api";
import {
  describeCloudProblem,
  formatCreditMicros,
  formatSandboxTime,
  fromCloudAgentId,
  getNextRunBaseBranch,
  getRunSandboxSeconds,
  getRunSpentMicros,
  orderCloudRepos,
  parsePullRequestUrl,
  pickDefaultCloudBranch,
  toCloudAgentId,
} from "../services/cloud-environment";
import { groupCloudSidebarEntries } from "../services/cloud-run-sidebar";

const NOW = Date.parse("2026-10-15T12:00:00Z");

function makeRun(id: string, patch: Partial<CloudAgentRun> = {}): CloudAgentRun {
  return {
    id,
    repo: "athasdev/athas",
    baseBranch: "main",
    branch: `athas/${id}`,
    title: `Run ${id}`,
    agent: "claude-code",
    status: "succeeded",
    pool: "included_allowance",
    maxMinutes: 60,
    billedSeconds: 300,
    chargedCents: 4,
    holdCents: 0,
    prUrl: null,
    error: null,
    createdAt: "2026-10-14T12:00:00Z",
    startedAt: "2026-10-14T12:00:05Z",
    finishedAt: "2026-10-14T12:05:05Z",
    ...patch,
  };
}

function makeChat(id: string, patch: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title: id,
    createdAt: new Date(NOW),
    lastMessageAt: new Date(NOW),
    agentId: "claude-acp",
    workspacePath: "/work/athas",
    ...patch,
  };
}

describe("cloud environment defaults", () => {
  it("starts from the checked-out branch when GitHub has it", () => {
    const remote = { defaultBranch: "main", branches: ["main", "feature"] };
    expect(pickDefaultCloudBranch({ localBranch: "feature", remote })).toBe("feature");
  });

  it("falls back to the default branch for a branch that was never pushed", () => {
    const remote = { defaultBranch: "main", branches: ["main"] };
    expect(pickDefaultCloudBranch({ localBranch: "local-only", remote })).toBe("main");
    expect(
      pickDefaultCloudBranch({
        localBranch: null,
        remote: { defaultBranch: null, branches: ["dev"] },
      }),
    ).toBe("dev");
  });

  it("guesses the checked-out branch without a branch list", () => {
    expect(pickDefaultCloudBranch({ localBranch: "feature", remote: null })).toBe("feature");
    expect(pickDefaultCloudBranch({ localBranch: null, remote: null })).toBeNull();
  });

  it("lists the project's repository first, then the most recently pushed", () => {
    const repos = [
      {
        fullName: "me/old",
        defaultBranch: "main",
        private: false,
        pushedAt: "2025-01-01T00:00:00Z",
      },
      {
        fullName: "me/new",
        defaultBranch: "main",
        private: true,
        pushedAt: "2026-10-01T00:00:00Z",
      },
      { fullName: "AthasDev/Athas", defaultBranch: "main", private: false, pushedAt: null },
    ];
    expect(orderCloudRepos(repos, "athasdev/athas").map((repo) => repo.fullName)).toEqual([
      "AthasDev/Athas",
      "me/new",
      "me/old",
    ]);
    expect(orderCloudRepos([], "athasdev/athas").map((repo) => repo.fullName)).toEqual([
      "athasdev/athas",
    ]);
  });

  it("maps the agents that can run in the cloud", () => {
    expect(toCloudAgentId("claude-acp")).toBe("claude-code");
    expect(toCloudAgentId("codex")).toBe("codex");
    expect(toCloudAgentId("gemini-cli")).toBeNull();
    expect(toCloudAgentId("custom")).toBeNull();
    expect(fromCloudAgentId("claude-code")).toBe("claude-acp");
  });

  it("continues a follow-up from the branch of the previous pull request", () => {
    const cloud = { repo: "athasdev/athas", branch: "main", runs: [] };
    expect(getNextRunBaseBranch(cloud, null)).toBe("main");
    expect(
      getNextRunBaseBranch(
        cloud,
        makeRun("a", { prUrl: "https://github.com/athasdev/athas/pull/9" }),
      ),
    ).toBe("athas/a");
    expect(getNextRunBaseBranch(cloud, makeRun("b", { status: "failed" }))).toBe("main");
  });
});

describe("cloud run readings", () => {
  it("prefers the reported spend and falls back to the charge", () => {
    expect(getRunSpentMicros(makeRun("a", { spentMicros: 420_000 }))).toBe(420_000);
    expect(getRunSpentMicros(makeRun("a", { chargedCents: 12 }))).toBe(120_000);
    expect(formatCreditMicros(420_000)).toBe("$0.42");
    expect(formatCreditMicros(2_000)).toBe("<$0.01");
  });

  it("measures a running sandbox and reports the billed time afterwards", () => {
    const running = makeRun("a", {
      status: "running",
      startedAt: new Date(NOW - 125_000).toISOString(),
    });
    expect(getRunSandboxSeconds(running, NOW)).toBe(125);
    expect(getRunSandboxSeconds(makeRun("b"), NOW)).toBe(300);
    expect(formatSandboxTime(125)).toBe("2m 05s");
    expect(formatSandboxTime(3_900)).toBe("1h 05m");
  });

  it("reads a pull request link", () => {
    expect(parsePullRequestUrl("https://github.com/athasdev/athas/pull/42")).toEqual({
      repo: "athasdev/athas",
      number: 42,
    });
    expect(parsePullRequestUrl("https://example.com/x")).toBeNull();
  });

  it("explains refused runs with the action that fixes them", () => {
    expect(describeCloudProblem({ message: "x", code: "github_not_connected" })).toMatchObject({
      action: "connect-github",
      actionLabel: "Connect GitHub",
    });
    expect(describeCloudProblem({ message: "x", code: "allowance_exhausted" })).toMatchObject({
      title: "Out of Athas credit",
      action: "open-billing",
    });
    expect(describeCloudProblem({ message: "x", code: "spend_cap_reached" }).action).toBe(
      "open-billing",
    );
    expect(describeCloudProblem({ message: "x", code: "pro_required" }).action).toBe("see-plans");
    expect(describeCloudProblem({ message: "Busy", code: "unavailable" })).toMatchObject({
      description: "Busy",
      action: "retry",
    });
  });
});

describe("cloud session settings", () => {
  it("keeps a session's cloud environment and runs across a save", () => {
    const saved = JSON.stringify({
      followAgent: true,
      cloud: {
        repo: "athasdev/athas",
        branch: "main",
        runs: [
          { messageId: "m1", runId: "r1" },
          {
            messageId: "m2",
            runId: null,
            error: { message: "Connect GitHub", code: "github_not_connected" },
          },
          { runId: "no-message" },
        ],
      },
    });
    expect(parseChatSessionSettings(saved)).toEqual({
      followAgent: true,
      cloud: {
        repo: "athasdev/athas",
        branch: "main",
        runs: [
          { messageId: "m1", runId: "r1" },
          {
            messageId: "m2",
            runId: null,
            error: { message: "Connect GitHub", code: "github_not_connected" },
          },
        ],
      },
    });
    expect(parseChatSessionSettings(JSON.stringify({ modeId: "plan" }))).toEqual({
      modeId: "plan",
    });
  });
});

describe("cloud runs in the sidebar", () => {
  const projects = [
    { id: "p1", path: "/work/athas" },
    { id: "p2", path: "/work/site" },
  ];
  const projectRepos = { "/work/athas": "athasdev/athas", "/work/site": null };

  it("lists runs without a session under the project of their repository, others under Cloud", () => {
    const groups = groupCloudSidebarEntries({
      runs: [
        makeRun("mine"),
        makeRun("adopted"),
        makeRun("elsewhere", { repo: "me/other" }),
        makeRun("old", { createdAt: "2026-08-01T00:00:00Z" }),
        makeRun("old-but-running", { createdAt: "2026-08-01T00:00:00Z", status: "running" }),
      ],
      chats: [
        makeChat("c1", {
          sessionSettings: {
            cloud: {
              repo: "athasdev/athas",
              branch: "main",
              runs: [{ messageId: "m", runId: "adopted" }],
            },
          },
        }),
      ],
      projects,
      projectRepos,
      now: NOW,
    });
    expect(groups.runsByProject.p1?.map((run) => run.id)).toEqual(["mine", "old-but-running"]);
    expect(groups.runsByProject.p2).toBeUndefined();
    expect(groups.otherRuns.map((run) => run.id)).toEqual(["elsewhere"]);
    expect(groups.otherChats).toEqual([]);
  });

  it("lists cloud sessions of repositories that are not open under Cloud", () => {
    const cloud = { repo: "me/other", branch: "main", runs: [] };
    const groups = groupCloudSidebarEntries({
      runs: [],
      chats: [
        makeChat("open-project", { sessionSettings: { cloud } }),
        makeChat("github", { workspacePath: "github://me/other", sessionSettings: { cloud } }),
        makeChat("local", { workspacePath: "github://me/other" }),
        makeChat("archived", {
          workspacePath: "github://me/other",
          sessionSettings: { cloud },
          archivedAt: new Date(),
        }),
      ],
      projects,
      projectRepos,
      now: NOW,
    });
    expect(groups.otherChats.map((chat) => chat.id)).toEqual(["github"]);
  });
});
