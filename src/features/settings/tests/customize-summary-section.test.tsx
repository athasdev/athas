// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async () => undefined,
    entries: async () => [],
    set: async () => {},
    save: async () => {},
  }),
}));

const openCustomize = vi.hoisted(() => vi.fn());
vi.mock("@/features/ai/customize/services/open-customize", () => ({ openCustomize }));

import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  AgentsSummarySection,
  McpServersSummarySection,
} from "../components/ai/customize-summary-section";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  openCustomize.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: {
      ...settings,
      mcpServers: [
        { id: "a", name: "a", enabled: true, transport: "stdio", command: "x", args: [], url: "" },
        { id: "b", name: "b", enabled: false, transport: "stdio", command: "x", args: [], url: "" },
      ],
      aiSkills: [{ id: "s", title: "Skill", content: "", createdAt: "", updatedAt: "" }],
    },
  });
  const actions = useAgentCatalogStore.getState().actions;
  useAgentCatalogStore.setState({
    agents: {
      data: [
        { id: "gemini-cli", installed: true } as never,
        { id: "x", installed: false } as never,
      ],
      status: "ready",
      error: null,
      updatedAt: Date.now(),
    },
    codex: { data: { installed: true } as never, status: "ready", error: null, updatedAt: 0 },
    actions: { ...actions, refresh: vi.fn(async () => {}) },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("settings entry points to Customize", () => {
  it("summarises MCP servers and opens their Customize page", () => {
    act(() => root.render(<McpServersSummarySection />));
    const view = within(container);
    expect(view.getByText("2 servers, 1 passed to agents")).toBeTruthy();
    fireEvent.click(view.getByText("Open Customize"));
    expect(openCustomize).toHaveBeenCalledWith("mcp");
  });

  it("summarises agents and skills, each opening its own page", () => {
    act(() => root.render(<AgentsSummarySection />));
    const view = within(container);
    expect(view.getByText(/^2 agents installed/)).toBeTruthy();
    expect(view.getByText("1 skill to hand to agents")).toBeTruthy();
    const [agents, skills] = view.getAllByText("Open Customize");
    fireEvent.click(agents);
    fireEvent.click(skills);
    expect(openCustomize.mock.calls).toEqual([["agents"], ["skills"]]);
  });
});
