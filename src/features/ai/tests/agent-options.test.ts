import { describe, expect, it } from "vite-plus/test";
import { buildAgentOptions, loadAgentAvailability } from "@/features/ai/lib/agent-options";
import type { AgentConfig } from "@/features/ai/types/acp.types";

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "claude-acp",
    name: "Claude Agent",
    binaryName: "claude-agent-acp",
    binaryPath: null,
    args: [],
    envVars: {},
    icon: null,
    description: "Claude through ACP",
    installed: false,
    installRuntime: "node",
    installPackage: "@agentclientprotocol/claude-agent-acp",
    availableVersion: "2.0.0",
    installedVersion: null,
    updateAvailable: false,
    managed: false,
    canInstall: true,
    ...overrides,
  };
}

describe("agent options", () => {
  it("keeps Codex availability when the ACP catalog fails", async () => {
    const result = await loadAgentAvailability(
      () => Promise.reject(new Error("offline")),
      () => Promise.resolve({ installed: true }),
    );

    expect(result.agents).toBeNull();
    expect(result.codexInstalled).toBe(true);
    expect(result.errors).toEqual(["Agent catalog: offline"]);
  });

  it("keeps ACP agents when Codex detection fails", async () => {
    const claude = agentConfig();
    const result = await loadAgentAvailability(
      () => Promise.resolve([claude]),
      () => Promise.reject("status unavailable"),
    );

    expect(result.agents).toEqual([claude]);
    expect(result.codexInstalled).toBeNull();
    expect(result.errors).toEqual(["Codex: status unavailable"]);
  });

  it("always lists Codex and exposes setup when it is not installed", () => {
    const options = buildAgentOptions({
      currentAgentId: "custom",
      agentConfigs: new Map(),
      codexInstalled: false,
      pendingAction: null,
    });

    expect(options.find((option) => option.id === "codex")).toMatchObject({
      isInstalled: false,
      needsSetup: true,
      action: null,
    });
  });

  it("keeps a stale selected agent visible as unavailable", () => {
    const options = buildAgentOptions({
      currentAgentId: "removed-agent",
      agentConfigs: new Map(),
      codexInstalled: true,
      pendingAction: null,
    });

    expect(options.find((option) => option.id === "removed-agent")).toMatchObject({
      name: "removed-agent",
      isCurrent: true,
      isInstalled: false,
      canInstall: false,
    });
  });

  it("distinguishes install, update, and in-progress agent actions", () => {
    const uninstalled = agentConfig();
    const installed = agentConfig({
      installed: true,
      binaryPath: "/managed/claude-acp",
      installedVersion: "1.0.0",
      updateAvailable: true,
      managed: true,
    });

    const installOption = buildAgentOptions({
      currentAgentId: "custom",
      agentConfigs: new Map([[uninstalled.id, uninstalled]]),
      codexInstalled: true,
      pendingAction: null,
    }).find((option) => option.id === uninstalled.id);
    const updateOption = buildAgentOptions({
      currentAgentId: "custom",
      agentConfigs: new Map([[installed.id, installed]]),
      codexInstalled: true,
      pendingAction: { agentId: installed.id, action: "update" },
    }).find((option) => option.id === installed.id);

    expect(installOption).toMatchObject({ action: "install", isBusy: false });
    expect(updateOption).toMatchObject({ action: "update", isBusy: true });
  });
});
