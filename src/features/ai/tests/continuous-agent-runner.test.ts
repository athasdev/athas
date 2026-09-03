import { describe, expect, it, vi } from "vite-plus/test";
import {
  buildContinuousAgentPrompt,
  checkContinuousAgentReadiness,
  runNextDueContinuousAgent,
  type ContinuousAgentReadiness,
  type ContinuousAgentRunDependencies,
} from "../continuous-agents/continuous-agent-runner";
import type { ContinuousAgentTask } from "../continuous-agents/continuous-agents.store";
import type { AgentConfig } from "../types/acp.types";

const NOW = Date.UTC(2026, 8, 3, 9, 0, 0);

function task(overrides: Partial<ContinuousAgentTask> = {}): ContinuousAgentTask {
  return {
    id: "task-1",
    name: "Keep tests green",
    prompt: "Run tests and fix regressions.",
    agentId: "codex",
    workspacePath: "/repo",
    cadence: "hourly",
    enabled: true,
    createdAt: NOW,
    nextRunAt: NOW,
    lastRunAt: null,
    lastChatId: null,
    runCount: 0,
    lastError: null,
    ...overrides,
  };
}

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "opencode",
    name: "OpenCode",
    binaryName: "opencode",
    binaryPath: "/bin/opencode",
    args: [],
    envVars: {},
    icon: null,
    description: null,
    installed: true,
    installRuntime: "node",
    installPackage: "opencode-ai",
    availableVersion: "1.0.0",
    installedVersion: "1.0.0",
    updateAvailable: false,
    managed: true,
    canInstall: true,
    ...overrides,
  };
}

function runtimeDependencies(
  overrides: Partial<ContinuousAgentRunDependencies> = {},
): ContinuousAgentRunDependencies {
  const dueTask = task();
  return {
    getWorkspacePath: vi.fn(() => "/repo"),
    isAgentBusy: vi.fn(() => false),
    getDueTask: vi.fn(() => dueTask),
    checkReadiness: vi.fn(async (): Promise<ContinuousAgentReadiness> => ({ status: "ready" })),
    claimTask: vi.fn(() => ({ ...dueTask, runCount: 1, lastRunAt: NOW })),
    launchTask: vi.fn(),
    pauseTask: vi.fn(),
    now: () => NOW,
    ...overrides,
  };
}

describe("continuous agent readiness", () => {
  it("accepts installed Codex and installed ACP agents", async () => {
    await expect(
      checkContinuousAgentReadiness(task(), {
        loadAcpAgents: async () => [],
        loadCodexStatus: async () => ({ installed: true }),
      }),
    ).resolves.toEqual({ status: "ready" });

    await expect(
      checkContinuousAgentReadiness(task({ agentId: "opencode" }), {
        loadAcpAgents: async () => [agent()],
        loadCodexStatus: async () => ({ installed: false }),
      }),
    ).resolves.toEqual({ status: "ready" });
  });

  it("blocks unsupported, removed, and uninstalled agents", async () => {
    const dependencies = {
      loadAcpAgents: async () => [agent({ installed: false })],
      loadCodexStatus: async () => ({ installed: false }),
    };

    await expect(
      checkContinuousAgentReadiness(task({ agentId: "custom" }), dependencies),
    ).resolves.toMatchObject({ status: "blocked" });
    await expect(
      checkContinuousAgentReadiness(task({ agentId: "claude-code" }), dependencies),
    ).resolves.toMatchObject({ status: "blocked" });
    await expect(checkContinuousAgentReadiness(task(), dependencies)).resolves.toMatchObject({
      status: "blocked",
    });
    await expect(
      checkContinuousAgentReadiness(task({ agentId: "missing" }), dependencies),
    ).resolves.toMatchObject({ status: "blocked" });
    await expect(
      checkContinuousAgentReadiness(task({ agentId: "opencode" }), dependencies),
    ).resolves.toMatchObject({ status: "blocked" });
  });

  it("retries transient availability failures without disabling the task", async () => {
    await expect(
      checkContinuousAgentReadiness(task(), {
        loadAcpAgents: async () => [],
        loadCodexStatus: async () => {
          throw new Error("temporary failure");
        },
      }),
    ).resolves.toEqual({ status: "retry" });

    await expect(
      checkContinuousAgentReadiness(task({ agentId: "opencode" }), {
        loadAcpAgents: async () => {
          throw new Error("temporary failure");
        },
        loadCodexStatus: async () => ({ installed: true }),
      }),
    ).resolves.toEqual({ status: "retry" });
  });
});

describe("continuous agent runner", () => {
  it("does nothing without a workspace or while another agent is busy", async () => {
    const noWorkspace = runtimeDependencies({ getWorkspacePath: () => null });
    await expect(runNextDueContinuousAgent(noWorkspace)).resolves.toEqual({ status: "idle" });
    expect(noWorkspace.getDueTask).not.toHaveBeenCalled();

    const busy = runtimeDependencies({ isAgentBusy: () => true });
    await expect(runNextDueContinuousAgent(busy)).resolves.toEqual({ status: "busy" });
    expect(busy.getDueTask).not.toHaveBeenCalled();
  });

  it("leaves due work untouched after a transient readiness failure", async () => {
    const dependencies = runtimeDependencies({
      checkReadiness: async () => ({ status: "retry" }),
    });

    await expect(runNextDueContinuousAgent(dependencies)).resolves.toEqual({ status: "retry" });
    expect(dependencies.claimTask).not.toHaveBeenCalled();
    expect(dependencies.pauseTask).not.toHaveBeenCalled();
  });

  it("pauses permanently unavailable agents before claiming a run", async () => {
    const dependencies = runtimeDependencies({
      checkReadiness: async () => ({ status: "blocked", reason: "Agent unavailable" }),
    });

    await expect(runNextDueContinuousAgent(dependencies)).resolves.toMatchObject({
      status: "paused",
      reason: "Agent unavailable",
    });
    expect(dependencies.claimTask).not.toHaveBeenCalled();
    expect(dependencies.pauseTask).toHaveBeenCalledWith("task-1", "Agent unavailable");
  });

  it("rechecks workspace and activity after asynchronous readiness", async () => {
    const workspaceChanged = runtimeDependencies({
      getWorkspacePath: vi
        .fn<() => string | null>()
        .mockReturnValueOnce("/repo")
        .mockReturnValue("/other"),
    });
    await expect(runNextDueContinuousAgent(workspaceChanged)).resolves.toEqual({ status: "idle" });
    expect(workspaceChanged.claimTask).not.toHaveBeenCalled();

    const becameBusy = runtimeDependencies({
      isAgentBusy: vi.fn<() => boolean>().mockReturnValueOnce(false).mockReturnValue(true),
    });
    await expect(runNextDueContinuousAgent(becameBusy)).resolves.toEqual({ status: "busy" });
    expect(becameBusy.claimTask).not.toHaveBeenCalled();
  });

  it("claims the expected due task once before launching it", async () => {
    const dependencies = runtimeDependencies();

    await expect(runNextDueContinuousAgent(dependencies)).resolves.toMatchObject({
      status: "started",
      task: { id: "task-1", runCount: 1 },
    });
    expect(dependencies.claimTask).toHaveBeenCalledWith("/repo", NOW, "task-1");
    expect(dependencies.launchTask).toHaveBeenCalledTimes(1);
  });

  it("pauses a claimed task when launching throws", async () => {
    const dependencies = runtimeDependencies({
      launchTask: () => {
        throw new Error("Pane unavailable");
      },
    });

    await expect(runNextDueContinuousAgent(dependencies)).resolves.toMatchObject({
      status: "paused",
      reason: "Pane unavailable",
    });
    expect(dependencies.pauseTask).toHaveBeenCalledWith("task-1", "Pane unavailable");
  });
});

describe("continuous agent prompt", () => {
  it("preserves the goal and adds autonomous verification boundaries", () => {
    const prompt = buildContinuousAgentPrompt("Keep tests green", "Run the focused tests.");

    expect(prompt).toContain("Keep tests green");
    expect(prompt).toContain("verify the result");
    expect(prompt).toContain("Run the focused tests.");
  });
});
