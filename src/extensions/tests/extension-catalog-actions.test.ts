// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands, type AgentConfig } from "@/bindings/commands";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { ToastInput } from "@/utils/toast";
import { useExtensionStore } from "../registry/extension-store";
import type { AvailableExtension } from "../registry/extension-store-types";
import type { UnifiedExtension } from "../ui/components/extension-catalog-types";
import { useExtensionCatalogActions } from "../ui/hooks/use-extension-catalog-actions";

const toasts = vi.hoisted(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve(null),
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
  return [] as ToastInput[];
});

vi.mock("@/utils/toast", () => ({
  useToast: () => ({
    showToast: (toast: ToastInput) => {
      toasts.push(toast);
      return "toast";
    },
  }),
}));

enableMapSet();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalActions = useExtensionStore.getState().actions;
const lifecycle = {
  installExtension: vi.fn<(extensionId: string) => Promise<void>>(),
  uninstallExtension: vi.fn<(extensionId: string) => Promise<void>>(),
  enableExtension: vi.fn<(extensionId: string) => Promise<void>>(),
  disableExtension: vi.fn<(extensionId: string) => Promise<void>>(),
  updateExtension: vi.fn<(extensionId: string) => Promise<void>>(),
};
const settingsWrites: Array<[string, unknown]> = [];

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "codex",
    name: "Codex",
    binaryName: "codex",
    binaryPath: null,
    args: [],
    envVars: {},
    icon: null,
    description: null,
    installed: false,
    installRuntime: "node",
    installPackage: null,
    availableVersion: "1.0.0",
    installedVersion: null,
    updateAvailable: false,
    managed: true,
    installCommand: null,
    canInstall: true,
    ...overrides,
  };
}

function extension(overrides: Partial<UnifiedExtension> = {}): UnifiedExtension {
  return {
    id: "athas.rust",
    name: "Rust",
    description: "Rust support",
    category: "language",
    isInstalled: false,
    isEnabled: false,
    isMarketplace: true,
    ...overrides,
  };
}

function installedSkill(overrides: Partial<AIChatSkill> = {}): AIChatSkill {
  return {
    id: "skill-review",
    title: "Review",
    description: "Review code",
    content: "Review carefully",
    source: "marketplace",
    sourceId: "review",
    version: "1.0.0",
    upstreamTitle: "Review",
    upstreamDescription: "Review code",
    upstreamContent: "Review carefully",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function marketplaceSkill(overrides: Partial<MarketplaceSkill> = {}): MarketplaceSkill {
  return {
    id: "review",
    title: "Review",
    description: "Review code thoroughly",
    content: "Review very carefully",
    version: "2.0.0",
    tags: ["review"],
    ...overrides,
  };
}

const roots: Root[] = [];

async function renderActions(aiSkills: AIChatSkill[] = []) {
  const result = { current: undefined as unknown as ReturnType<typeof useExtensionCatalogActions> };
  function Harness() {
    result.current = useExtensionCatalogActions({ aiSkills });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(result.current.isLoadingAgents).toBe(false);
  return { result };
}

function lastToast() {
  return toasts[toasts.length - 1];
}

beforeEach(() => {
  toasts.length = 0;
  settingsWrites.length = 0;
  for (const fn of Object.values(lifecycle)) fn.mockReset().mockResolvedValue(undefined);
  useExtensionStore.setState({
    availableExtensions: new Map(),
    extensionsWithUpdates: new Set(),
    actions: { ...originalActions, ...lifecycle },
  });
  vi.spyOn(useSettingsStore.getState().actions, "updateSetting").mockImplementation(
    async (key, value) => {
      settingsWrites.push([key, value]);
    },
  );
  vi.spyOn(commands, "getAvailableAgents").mockResolvedValue([agent()]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useExtensionStore.setState({ actions: originalActions });
});

describe("ACP agent catalog actions", () => {
  it("loads available agents on mount and falls back to none when loading fails", async () => {
    const { result } = await renderActions();
    expect(result.current.agents.map((item) => item.id)).toEqual(["codex"]);

    vi.mocked(commands.getAvailableAgents).mockRejectedValueOnce(new Error("offline"));
    const failed = await renderActions();
    expect(failed.result.current.agents).toEqual([]);
  });

  it("installs an agent, tracks the pending install, and merges the result", async () => {
    let finishInstall: (value: AgentConfig) => void = () => undefined;
    vi.spyOn(commands, "installAcpAgent").mockImplementation(
      () => new Promise((resolve) => (finishInstall = resolve)),
    );
    const { result } = await renderActions();
    vi.mocked(commands.getAvailableAgents).mockReturnValue(new Promise(() => undefined));
    const entry = extension({ id: "agent:codex", name: "Codex", category: "agent" });

    let pending: unknown;
    act(() => {
      pending = result.current.actions.toggle(entry);
    });
    expect(commands.installAcpAgent).toHaveBeenCalledWith("codex");
    expect(result.current.actions.isInstalling(entry)).toBe(true);

    await act(async () => {
      finishInstall(agent({ installed: true, installedVersion: "1.0.0" }));
      await pending;
    });

    expect(result.current.actions.isInstalling(entry)).toBe(false);
    expect(result.current.agents.find((item) => item.id === "codex")?.installed).toBe(true);
    expect(lastToast()).toMatchObject({ message: "Codex installed successfully", type: "success" });
  });

  it("explains when an uninstall leaves a global agent binary on PATH", async () => {
    vi.spyOn(commands, "uninstallAcpAgent").mockResolvedValue(agent({ installed: true }));
    const { result } = await renderActions();

    await act(() =>
      result.current.actions.uninstall(
        extension({ id: "agent:codex", name: "Codex", category: "agent", isInstalled: true }),
      ),
    );

    expect(lastToast()).toMatchObject({
      message: "Codex managed install removed",
      description: "A global installation is still detected on your PATH.",
      type: "info",
    });
  });

  it("reports a clean agent uninstall and agent failures", async () => {
    vi.spyOn(commands, "uninstallAcpAgent")
      .mockResolvedValueOnce(agent({ installed: false }))
      .mockRejectedValueOnce("permission denied");
    const { result } = await renderActions();
    const entry = extension({
      id: "agent:codex",
      agentId: "codex",
      name: "Codex",
      category: "agent",
      isInstalled: true,
    });

    await act(() => result.current.actions.toggle(entry));
    expect(lastToast()).toMatchObject({ message: "Codex uninstalled successfully" });

    await act(() => result.current.actions.toggle(entry));
    expect(lastToast()).toMatchObject({
      message: "Failed to uninstall Codex: permission denied",
      type: "error",
    });
    expect(result.current.actions.isInstalling(entry)).toBe(false);
  });

  it("refuses to install agents that cannot be installed automatically", async () => {
    const install = vi.spyOn(commands, "installAcpAgent");
    const { result } = await renderActions();

    await act(() =>
      result.current.actions.toggle(
        extension({ id: "agent:custom", name: "Custom", category: "agent", canInstall: false }),
      ),
    );

    expect(install).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({
      message: "Custom cannot be installed automatically",
      type: "error",
    });
  });

  it("updates an agent and reports the installed version or the failure", async () => {
    vi.spyOn(commands, "updateAcpAgent")
      .mockResolvedValueOnce(agent({ installed: true, installedVersion: "2.0.0" }))
      .mockRejectedValueOnce(new Error("network down"));
    const { result } = await renderActions();
    vi.mocked(commands.getAvailableAgents).mockResolvedValue([
      agent({ installed: true, installedVersion: "2.0.0" }),
      agent({ id: "gemini", name: "Gemini" }),
    ]);
    const entry = extension({ id: "agent:codex", name: "Codex", category: "agent" });

    await act(() => result.current.actions.update(entry));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(lastToast()).toMatchObject({
      message: "Codex updated successfully",
      description: "Installed version 2.0.0",
    });
    expect(result.current.agents.map((item) => [item.id, item.installedVersion])).toEqual([
      ["codex", "2.0.0"],
      ["gemini", null],
    ]);

    await act(() => result.current.actions.update(entry));
    expect(lastToast()).toMatchObject({ message: "Failed to update Codex: network down" });
  });
});

describe("skill catalog actions", () => {
  it("adds a marketplace skill ahead of existing skills", async () => {
    const existing = installedSkill({ id: "skill-other", sourceId: "other" });
    const { result } = await renderActions([existing]);

    await act(() =>
      result.current.actions.toggle(
        extension({
          id: "skill:review",
          name: "Review",
          category: "skill",
          marketplaceSkill: marketplaceSkill(),
        }),
      ),
    );

    const [key, value] = settingsWrites[0];
    const skills = value as AIChatSkill[];
    expect(key).toBe("aiSkills");
    expect(skills).toHaveLength(2);
    expect(skills[0]).toMatchObject({
      title: "Review",
      content: "Review very carefully",
      source: "marketplace",
      sourceId: "review",
      localOverride: false,
    });
    expect(skills[1]).toBe(existing);
    expect(lastToast()).toMatchObject({ message: "Review added successfully" });
  });

  it("resolves marketplace skill instructions from the detail url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("---\nname: review\n---\nFetched instructions")),
    );
    const { result } = await renderActions();

    await act(() =>
      result.current.actions.toggle(
        extension({
          id: "skill:review",
          name: "Review",
          category: "skill",
          marketplaceSkill: marketplaceSkill({
            content: undefined,
            detailUrl: "https://skills.example/review",
          }),
        }),
      ),
    );

    expect((settingsWrites[0][1] as AIChatSkill[])[0].content).toBe("Fetched instructions");
  });

  it("surfaces skills that cannot be resolved without writing settings", async () => {
    const { result } = await renderActions();

    await act(() =>
      result.current.actions.toggle(
        extension({
          id: "skill:broken",
          name: "Broken",
          category: "skill",
          marketplaceSkill: marketplaceSkill({ title: "Broken", content: " " }),
        }),
      ),
    );

    expect(settingsWrites).toEqual([]);
    expect(lastToast()).toMatchObject({
      message: "Failed to update Broken: Broken does not provide installable instructions",
      type: "error",
    });
  });

  it("removes an installed skill together with copies from the same source", async () => {
    const skill = installedSkill();
    const duplicate = installedSkill({ id: "skill-review-copy" });
    const unrelated = installedSkill({ id: "skill-other", sourceId: "other" });
    const { result } = await renderActions([skill, duplicate, unrelated]);

    await act(() =>
      result.current.actions.uninstall(
        extension({
          id: skill.id,
          name: "Review",
          category: "skill",
          isInstalled: true,
          skill,
        }),
      ),
    );

    expect(settingsWrites).toEqual([["aiSkills", [unrelated]]]);
    expect(lastToast()).toMatchObject({ message: "Review removed successfully" });
  });

  it("updates a skill from the marketplace while keeping a local override", async () => {
    const overridden = installedSkill({ content: "My own instructions", localOverride: true });
    const other = installedSkill({ id: "skill-other", sourceId: "other" });
    const { result } = await renderActions([overridden, other]);
    const entry = extension({
      id: overridden.id,
      name: "Review",
      category: "skill",
      isInstalled: true,
      skill: overridden,
      marketplaceSkill: marketplaceSkill(),
    });

    expect(result.current.actions.hasUpdate(entry)).toBe(true);
    await act(() => result.current.actions.update(entry));

    const [updated, untouched] = settingsWrites[0][1] as AIChatSkill[];
    expect(updated).toMatchObject({
      content: "My own instructions",
      upstreamContent: "Review very carefully",
      version: "2.0.0",
      localOverride: true,
    });
    expect(untouched).toBe(other);
    expect(lastToast()).toMatchObject({ message: "Review updated, local override kept" });
  });

  it("ignores skill updates without marketplace data and reports update failures", async () => {
    const skill = installedSkill();
    const { result } = await renderActions([skill]);

    await act(() =>
      result.current.actions.update(extension({ category: "skill", isInstalled: true, skill })),
    );
    expect(settingsWrites).toEqual([]);
    expect(toasts).toEqual([]);

    vi.mocked(useSettingsStore.getState().actions.updateSetting).mockRejectedValueOnce(
      new Error("disk full"),
    );
    await act(() =>
      result.current.actions.update(
        extension({
          name: "Review",
          category: "skill",
          isInstalled: true,
          skill,
          marketplaceSkill: marketplaceSkill(),
        }),
      ),
    );
    expect(lastToast()).toMatchObject({ message: "Failed to update Review: disk full" });
  });

  it("resets a local override back to the marketplace version", async () => {
    const overridden = installedSkill({ title: "Mine", content: "Mine", localOverride: true });
    const { result } = await renderActions([overridden]);
    const entry = extension({
      name: "Review",
      category: "skill",
      isInstalled: true,
      skill: overridden,
    });

    await act(() => result.current.actions.resetSkillOverride(entry));
    expect((settingsWrites[0][1] as AIChatSkill[])[0]).toMatchObject({
      title: "Review",
      content: "Review carefully",
      localOverride: false,
    });
    expect(lastToast()).toMatchObject({ message: "Review reset to marketplace version" });

    await act(() => result.current.actions.resetSkillOverride(extension()));
    expect(settingsWrites).toHaveLength(1);

    vi.mocked(useSettingsStore.getState().actions.updateSetting).mockRejectedValueOnce("locked");
    await act(() => result.current.actions.resetSkillOverride(entry));
    expect(lastToast()).toMatchObject({ message: "Failed to reset Review: locked" });
  });
});

describe("appearance catalog actions", () => {
  const theme = extension({
    id: "athas.nord",
    name: "Nord",
    category: "theme",
    isInstalled: true,
    isEnabled: true,
    appearanceOptions: [
      { id: "nord-dark", name: "Nord Dark" },
      { id: "nord-light", name: "Nord Light" },
    ],
  });

  it("selects a specific appearance option and enables disabled themes first", async () => {
    const { result } = await renderActions();

    await act(() =>
      result.current.actions.applyAppearance({ ...theme, isEnabled: false }, "nord-light"),
    );

    expect(lifecycle.enableExtension).toHaveBeenCalledWith("athas.nord");
    expect(settingsWrites).toEqual([["theme", "nord-light"]]);
    expect(lastToast()).toMatchObject({ message: "Nord Light selected" });
  });

  it("uses the icon theme setting and falls back to the extension id", async () => {
    const { result } = await renderActions();

    await act(() =>
      result.current.actions.toggle(
        extension({
          id: "athas.material-icons",
          name: "Material",
          category: "icon-theme",
          isInstalled: true,
          isEnabled: true,
        }),
      ),
    );

    expect(settingsWrites).toEqual([["iconTheme", "athas.material-icons"]]);
    expect(lastToast()).toMatchObject({ message: "Material selected" });
  });

  it("activates a disabled appearance on toggle and leaves the current one alone", async () => {
    const { result } = await renderActions();

    await act(() => result.current.actions.toggle({ ...theme, isEnabled: false }));
    expect(lifecycle.enableExtension).toHaveBeenCalledWith("athas.nord");
    expect(settingsWrites).toEqual([]);
    expect(lastToast()).toMatchObject({ message: "Nord activated" });

    toasts.length = 0;
    await act(() => result.current.actions.toggle({ ...theme, isActive: true }));
    expect(settingsWrites).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it("ignores appearance selection for uninstalled or non-appearance extensions", async () => {
    const { result } = await renderActions();

    await act(() => result.current.actions.applyAppearance({ ...theme, isInstalled: false }));
    await act(() => result.current.actions.applyAppearance(extension({ isInstalled: true })));

    expect(settingsWrites).toEqual([]);
  });

  it("reports appearance selection failures", async () => {
    lifecycle.enableExtension.mockRejectedValueOnce(new Error("bad theme"));
    const { result } = await renderActions();

    await act(() => result.current.actions.applyAppearance({ ...theme, isEnabled: false }));

    expect(settingsWrites).toEqual([]);
    expect(lastToast()).toMatchObject({ message: "Failed to use Nord: bad theme", type: "error" });
  });
});

describe("marketplace extension catalog actions", () => {
  it("installs marketplace extensions and reports install failures", async () => {
    lifecycle.installExtension
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error(""));
    const { result } = await renderActions();

    await act(() => result.current.actions.toggle(extension()));
    expect(lastToast()).toMatchObject({ message: "Rust installed successfully" });

    await act(() => result.current.actions.toggle(extension()));
    expect(lastToast()).toMatchObject({ message: "Failed to install Rust: Unknown error" });
  });

  it("does nothing for uninstalled extensions outside of the marketplace", async () => {
    const { result } = await renderActions();

    await act(() => result.current.actions.toggle(extension({ isMarketplace: false })));
    await act(() => result.current.actions.uninstall(extension({ isInstalled: false })));

    expect(lifecycle.installExtension).not.toHaveBeenCalled();
    expect(lifecycle.uninstallExtension).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });

  it("toggles installed extensions between enabled and disabled", async () => {
    lifecycle.disableExtension.mockRejectedValueOnce(new Error("in use"));
    const { result } = await renderActions();

    await act(() => result.current.actions.toggle(extension({ isInstalled: true })));
    expect(lifecycle.enableExtension).toHaveBeenCalledWith("athas.rust");
    expect(lastToast()).toMatchObject({ message: "Rust activated" });

    await act(() =>
      result.current.actions.toggle(extension({ isInstalled: true, isEnabled: true })),
    );
    expect(lastToast()).toMatchObject({ message: "Failed to deactivate Rust: in use" });
  });

  it("activates and deactivates only when the state actually changes", async () => {
    lifecycle.enableExtension.mockRejectedValueOnce("boom");
    const { result } = await renderActions();
    const installed = extension({ isInstalled: true });

    await act(() => result.current.actions.activate({ ...installed, isEnabled: true }));
    await act(() => result.current.actions.deactivate(installed));
    expect(toasts).toEqual([]);

    await act(() => result.current.actions.activate(installed));
    expect(lastToast()).toMatchObject({ message: "Failed to activate Rust: boom" });

    await act(() => result.current.actions.deactivate({ ...installed, isEnabled: true }));
    expect(lastToast()).toMatchObject({ message: "Rust deactivated" });

    lifecycle.disableExtension.mockRejectedValueOnce(new Error("locked"));
    await act(() => result.current.actions.deactivate({ ...installed, isEnabled: true }));
    expect(lastToast()).toMatchObject({ message: "Failed to deactivate Rust: locked" });
  });

  it("uninstalls and updates marketplace extensions", async () => {
    lifecycle.uninstallExtension.mockResolvedValueOnce(undefined).mockRejectedValueOnce("busy");
    lifecycle.updateExtension.mockResolvedValueOnce(undefined).mockRejectedValueOnce("offline");
    const { result } = await renderActions();
    const installed = extension({ isInstalled: true });

    await act(() => result.current.actions.uninstall(installed));
    expect(lastToast()).toMatchObject({ message: "Rust uninstalled successfully" });
    await act(() => result.current.actions.uninstall(installed));
    expect(lastToast()).toMatchObject({ message: "Failed to uninstall Rust: busy" });

    await act(() => result.current.actions.update(installed));
    expect(lastToast()).toMatchObject({ message: "Rust updated successfully" });
    await act(() => result.current.actions.update(installed));
    expect(lastToast()).toMatchObject({ message: "Failed to update Rust: offline" });
  });

  it("derives installing and update state from the extension store", async () => {
    const { result } = await renderActions();

    act(() => {
      useExtensionStore.setState({
        availableExtensions: new Map([
          ["athas.rust", { isInstalling: true } as unknown as AvailableExtension],
        ]),
        extensionsWithUpdates: new Set(["athas.go"]),
      });
    });

    expect(result.current.actions.isInstalling(extension())).toBe(true);
    expect(result.current.actions.isInstalling(extension({ id: "athas.go" }))).toBe(false);
    expect(result.current.actions.hasUpdate(extension({ id: "athas.go" }))).toBe(true);
    expect(result.current.actions.hasUpdate(extension({ hasUpdate: true }))).toBe(true);
    expect(result.current.actions.hasUpdate(extension())).toBe(false);
  });
});
