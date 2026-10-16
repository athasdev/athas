import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { commands } from "@/bindings/commands";
import { useAgentCatalogStore } from "../stores/agent-catalog.store";

const agent = (id: string, version = "1.0.0") => ({ id, name: id, version }) as never;
const state = () => useAgentCatalogStore.getState();
const empty = { data: null, status: "idle", error: null, updatedAt: 0 } as const;

beforeEach(() => {
  vi.clearAllMocks();
  useAgentCatalogStore.setState({ agents: { ...empty }, codex: { ...empty }, pendingAction: null });
  vi.spyOn(commands, "getAvailableAgents").mockResolvedValue([agent("claude-code")]);
  vi.spyOn(commands, "refreshAcpAgentRegistry").mockResolvedValue([agent("gemini")]);
  vi.spyOn(commands, "getCodexStatus").mockResolvedValue({ installed: true } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent catalog", () => {
  it("loads agents and Codex once and reuses fresh results", async () => {
    await state().actions.refresh();

    expect(state().agents).toMatchObject({ status: "ready", data: [{ id: "claude-code" }] });
    expect(state().codex).toMatchObject({ status: "ready", data: { installed: true } });

    await state().actions.refresh();
    expect(commands.getAvailableAgents).toHaveBeenCalledTimes(1);
  });

  it("downloads the registry again on a forced refresh", async () => {
    await state().actions.refresh(true);
    expect(commands.refreshAcpAgentRegistry).toHaveBeenCalled();
    expect(state().agents.data).toEqual([agent("gemini")]);
  });

  it("shares a request that is already running", async () => {
    await Promise.all([state().actions.refreshCodex(), state().actions.refreshCodex()]);
    expect(commands.getCodexStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the last data and shows the error when discovery fails", async () => {
    await state().actions.refresh(true);
    vi.mocked(commands.refreshAcpAgentRegistry).mockRejectedValue(new Error("registry offline"));
    await state().actions.refresh(true);
    expect(state().agents).toMatchObject({
      status: "error",
      error: "registry offline",
      data: [agent("gemini")],
    });
  });

  it("times out a discovery that hangs", async () => {
    vi.useFakeTimers();
    vi.mocked(commands.getCodexStatus).mockReturnValue(new Promise(() => {}));

    const pending = state().actions.refreshCodex();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;

    expect(state().codex).toMatchObject({
      status: "error",
      error: "Codex discovery timed out. Please retry.",
    });
  });

  it("installs an agent, replaces its entry and refreshes the list", async () => {
    await state().actions.refresh();
    vi.spyOn(commands, "installAcpAgent").mockImplementation(async () => {
      expect(state().pendingAction).toEqual({ agentId: "claude-code", action: "install" });
      return agent("claude-code", "2.0.0");
    });

    await state().actions.runAgentAction("claude-code", "Claude Code", "install");

    expect(toast.success).toHaveBeenCalledWith("Claude Code installed");
    expect(state().pendingAction).toBeNull();
    expect(commands.getAvailableAgents).toHaveBeenCalledTimes(2);
  });

  it("reports a failed update with the reason", async () => {
    vi.spyOn(commands, "updateAcpAgent").mockRejectedValue(new Error("npm ERR! 404"));

    await state().actions.runAgentAction("gemini", "Gemini CLI", "update");

    expect(toast.error).toHaveBeenCalledWith("Failed to update Gemini CLI", {
      description: "npm ERR! 404",
    });
    expect(state().pendingAction).toBeNull();
  });

  it("uninstalls an agent and says when a global install is still on the PATH", async () => {
    vi.spyOn(commands, "uninstallAcpAgent")
      .mockResolvedValueOnce({ id: "gemini", name: "gemini", installed: false } as never)
      .mockResolvedValueOnce({ id: "gemini", name: "gemini", installed: true } as never);

    await state().actions.runAgentAction("gemini", "Gemini CLI", "uninstall");
    expect(toast.success).toHaveBeenCalledWith("Gemini CLI uninstalled");

    await state().actions.runAgentAction("gemini", "Gemini CLI", "uninstall");
    expect(toast.info).toHaveBeenCalledWith("Gemini CLI managed install removed", {
      description: "A global installation is still detected on your PATH.",
    });
  });

  it("ignores actions for built-in agents and while another runs", async () => {
    const install = vi.spyOn(commands, "installAcpAgent");
    await state().actions.runAgentAction("custom", "Athas", "install");
    await state().actions.runAgentAction("codex", "Codex", "install");
    useAgentCatalogStore.setState({ pendingAction: { agentId: "x", action: "install" } });
    await state().actions.runAgentAction("gemini", "Gemini", "install");
    expect(install).not.toHaveBeenCalled();
  });
});
