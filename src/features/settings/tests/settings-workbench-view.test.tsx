// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
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

vi.mock("../components/tabs/general-settings", () => ({
  GeneralSettings: () => <p>General page</p>,
}));
vi.mock("../components/tabs/appearance-settings", () => ({
  AppearanceSettings: () => <p>Appearance page</p>,
}));
vi.mock("../components/tabs/keyboard-settings", async () => {
  const { default: Section, SettingRow } = await import("../components/settings-section");
  return {
    KeyboardSettings: () => (
      <Section title="Keyboard">
        <SettingRow label="Vim Mode">
          <input aria-label="Vim toggle" />
        </SettingRow>
      </Section>
    ),
  };
});
vi.mock("../components/tabs/editor-settings", () => ({
  EditorSettings: () => <p>Editor page</p>,
}));
vi.mock("../components/tabs/terminal-settings", () => ({
  TerminalSettings: () => <p>Terminal page</p>,
}));
vi.mock("../components/tabs/git-settings", () => ({ GitSettings: () => <p>Git page</p> }));
vi.mock("../components/tabs/file-tree-settings", () => ({
  FileTreeSettings: () => <p>File tree page</p>,
}));
vi.mock("../components/tabs/notifications-settings", () => ({
  NotificationsSettings: () => <p>Notifications page</p>,
}));
vi.mock("../components/tabs/advanced-settings", () => ({
  AdvancedSettings: () => <p>Advanced page</p>,
}));
vi.mock("../components/tabs/account-settings", () => ({
  AccountSettings: () => <p>Account page</p>,
}));
vi.mock("../components/tabs/collaboration-settings", () => ({
  CollaborationSettings: () => <p>Collaboration page</p>,
}));
vi.mock("../components/tabs/enterprise-settings", () => ({
  EnterpriseSettings: () => <p>Enterprise page</p>,
}));
vi.mock("../components/tabs/ai-settings", () => ({
  AIOverviewSettings: () => <p>AI overview page</p>,
  AIModelsSettings: () => <p>AI models page</p>,
  TabCompletionSettings: () => <p>Completion page</p>,
  AIAgentsSettings: () => <p>Agents page</p>,
  McpSettings: () => <p>MCP page</p>,
}));
vi.mock("@/features/sharing/components/sharing-settings", () => ({
  SharingSettings: () => <p>Sharing page</p>,
}));

import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import SettingsWorkbenchView from "../components/settings-workbench-view";
import { getDefaultSettingsSnapshot } from "../config/default-settings";
import { useSettingsSearchStore } from "../stores/settings-search.store";
import { useSettingsStore } from "../stores/settings.store";

enableMapSet();

let root: Root;
let container: HTMLDivElement;
let scrolled: Element[];

const body = () => within(document.body);
const region = () => body().getByRole("region");
const page = () => region().querySelector("p")?.textContent;

function button(text: string) {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!match) throw new Error(`No button labelled ${text}`);
  return match;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function render() {
  await act(async () => root.render(<SettingsWorkbenchView />));
  await flush();
}

const searchInput = () => body().getByPlaceholderText("Search settings");

async function search(query: string) {
  await act(async () => {
    fireEvent.change(searchInput(), { target: { value: query } });
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useSettingsStore.setState({ settings: getDefaultSettingsSnapshot() });
  useAuthStore.setState({ subscription: null });
  useSettingsSearchStore.getState().actions.clear();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings workbench view", () => {
  it("opens the general page first and switches pages from the navigation", async () => {
    await render();

    expect(page()).toBe("General page");
    expect(region().getAttribute("aria-label")).toBe("General settings");

    await act(async () => button("Keybindings").click());
    await flush();

    expect(region().getAttribute("aria-label")).toBe("Keybindings settings");
    expect(region().id).toBe("settings-panel-keyboard");
    expect(document.getElementById("settings-tab-keyboard")?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(useSettingsStore.getState().settings.lastSettingsTab).toBe("keyboard");
  });

  it.each([
    ["account", "Account page"],
    ["sharing", "Sharing page"],
    ["appearance", "Appearance page"],
    ["notifications", "Notifications page"],
    ["editor", "Editor page"],
    ["file-explorer", "File tree page"],
    ["git", "Git page"],
    ["ai", "AI overview page"],
    ["ai-models", "AI models page"],
    ["ai-completion", "Completion page"],
    ["ai-agents", "Agents page"],
    ["ai-mcp", "MCP page"],
    ["advanced", "Advanced page"],
  ])("shows the %s page from the navigation", async (tab, text) => {
    await render();

    await act(async () => document.getElementById(`settings-tab-${tab}`)!.click());
    await flush();

    expect(page()).toBe(text);
    expect(region().id).toBe(`settings-panel-${tab}`);
  });

  it("opens each page at its top instead of the last page's scroll offset", async () => {
    await render();
    region().scrollTop = 900;

    await act(async () => button("Keybindings").click());
    await flush();

    expect(region().scrollTop).toBe(0);
  });

  it("remembers a page opened directly from elsewhere", async () => {
    useUIState.getState().setSettingsInitialTab("terminal");
    await render();

    expect(page()).toBe("Terminal page");
    expect(useSettingsStore.getState().settings.lastSettingsTab).toBe("terminal");
  });

  it("keeps enterprise settings hidden without enterprise access", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, lastSettingsTab: "enterprise" },
    }));
    await render();

    expect(page()).toBe("General page");
    expect(body().queryByText("Enterprise")).toBeNull();
  });

  it("lists matching settings and opens the first match on Enter", async () => {
    await render();

    await search("vim mode");
    const results = body().getByRole("list", { name: "Matching settings" });
    expect(within(results).getByText("Vim Mode")).toBeTruthy();
    expect(body().queryByRole("navigation", { name: "Settings pages" })).toBeNull();

    await act(async () => {
      fireEvent.keyDown(searchInput(), { key: "Enter" });
    });
    await flush();

    expect(region().getAttribute("aria-label")).toBe("Keybindings settings");
    const row = region().querySelector('[data-setting-row-label="Vim Mode"]')!;
    expect(row.getAttribute("data-settings-search-active")).toBe("true");
    expect(row.closest("[data-highlighted='true']")).not.toBeNull();
    expect(document.activeElement).toBe(row);
    expect(scrolled).toContain(row);
  });

  it("opens a clicked search result and clears the highlight with the search", async () => {
    await render();

    await search("vim mode");
    const result = within(body().getByRole("list", { name: "Matching settings" }))
      .getByText("Vim Mode")
      .closest("button")!;
    await act(async () => result.click());
    await flush();
    const row = region().querySelector('[data-setting-row-label="Vim Mode"]')!;
    expect(row.getAttribute("data-settings-search-active")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(searchInput(), { key: "Escape" });
    });
    await flush();

    expect((searchInput() as HTMLInputElement).value).toBe("");
    expect(row.hasAttribute("data-settings-search-active")).toBe(false);
    expect(body().getByRole("navigation", { name: "Settings pages" })).toBeTruthy();
  });

  it("says when nothing matches and ignores Enter", async () => {
    await render();

    await search("zzzz-nothing");
    expect(body().getByText("No matching settings")).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(searchInput(), { key: "Enter" });
    });
    await flush();
    expect(page()).toBe("General page");
  });

  it("scrolls to a requested section", async () => {
    useUIState.getState().setSettingsInitialTab("keyboard");
    useUIState.getState().setSettingsInitialSection("Keyboard");
    await render();

    expect(scrolled).toContain(region().querySelector('[data-settings-section="Keyboard"]'));
  });

  it("clears the settings search when the page closes", async () => {
    await render();
    await search("vim");
    expect(useSettingsSearchStore.getState().query).toBe("vim");

    await act(async () => root.unmount());
    root = createRoot(container);

    expect(useSettingsSearchStore.getState().query).toBe("");
  });
});
