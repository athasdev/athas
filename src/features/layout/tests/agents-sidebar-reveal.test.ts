import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const settings = vi.hoisted(() => ({
  value: { coreFeatures: { aiChat: true }, hiddenSidebarActivityItems: [] as string[] },
}));

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: settings.value }) },
}));

import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import {
  resetAgentsSidebarRevealForTests,
  revealAgentsSidebar,
  watchAgentsSidebarDismissal,
} from "../services/agents-sidebar-reveal";
import { useUIState } from "../stores/ui-state.store";

const sidebar = () => {
  const { isSidebarVisible, activeSidebarView } = useUIState.getState();
  return { isSidebarVisible, activeSidebarView };
};

let stopWatching: () => void;

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "project-a", name: "A" });
  resetAgentsSidebarRevealForTests();
  settings.value = { coreFeatures: { aiChat: true }, hiddenSidebarActivityItems: [] };
  useUIState.getState().setActiveView("files");
  useUIState.getState().setIsSidebarVisible(false);
  stopWatching = watchAgentsSidebarDismissal();
});

afterEach(() => stopWatching());

describe("revealAgentsSidebar", () => {
  it("opens the agents sidebar when an agent starts", () => {
    revealAgentsSidebar();
    expect(sidebar()).toEqual({ isSidebarVisible: true, activeSidebarView: "agents" });
  });

  it("stays closed for the session once the user closes it", () => {
    revealAgentsSidebar();
    useUIState.getState().setIsSidebarVisible(false);

    revealAgentsSidebar();
    expect(sidebar().isSidebarVisible).toBe(false);
  });

  it("does not pull the user back after they switch to another view", () => {
    revealAgentsSidebar();
    useUIState.getState().setActiveView("files");

    revealAgentsSidebar();
    expect(sidebar()).toEqual({ isSidebarVisible: true, activeSidebarView: "files" });
  });

  it("ignores sidebar differences between projects when switching", () => {
    revealAgentsSidebar();
    workspaceRuntimeRegistry.activateWorkspace({ id: "project-b", name: "B" });
    useUIState.getState().setActiveView("files");
    useUIState.getState().setIsSidebarVisible(false);
    workspaceRuntimeRegistry.activateWorkspace({ id: "project-a", name: "A" });

    workspaceRuntimeRegistry.activateWorkspace({ id: "project-b", name: "B" });
    revealAgentsSidebar();
    expect(sidebar()).toEqual({ isSidebarVisible: true, activeSidebarView: "agents" });
  });

  it("leaves the sidebar alone when agents are turned off or hidden from the rail", () => {
    settings.value = { coreFeatures: { aiChat: false }, hiddenSidebarActivityItems: [] };
    revealAgentsSidebar();
    expect(sidebar().isSidebarVisible).toBe(false);

    settings.value = { coreFeatures: { aiChat: true }, hiddenSidebarActivityItems: ["agents"] };
    revealAgentsSidebar();
    expect(sidebar().isSidebarVisible).toBe(false);
  });
});
