// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useExtensionStore } from "../registry/extension-store";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) =>
        Promise.resolve(
          cmd === "get_available_agents"
            ? [
                {
                  id: "claude-code",
                  name: "Claude Code",
                  description: "Agent",
                  binaryName: "claude",
                  installed: true,
                },
              ]
            : cmd.includes("get_all")
              ? []
              : null,
        ),
      transformCallback: () => 1,
      convertFileSrc: (path: string) => `asset://localhost${path}`,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    skills: [] as MarketplaceSkill[],
    stored: new Map<string, unknown>(),
    detail: "Write the failing test first" as string | null,
    registryLoads: 0,
  };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => io.stored.get(key),
    entries: async () => [...io.stored.entries()],
    set: async (key: string, value: unknown) => {
      io.stored.set(key, structuredClone(value));
    },
    save: async () => {},
  }),
}));
vi.mock("@/extensions/marketplace/marketplace-skills", () => ({
  loadMarketplaceSkillContributions: async () => io.skills,
}));
vi.mock("@/features/ai/components/messages/markdown-renderer", () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

const { ExtensionsView, ExtensionDetails } = await import("../ui/components/extensions-view");

enableMapSet();

const TESTS_SKILL: MarketplaceSkill = {
  id: "athas.tests",
  title: "Test writer",
  description: "Adds focused tests",
  tags: ["testing"],
  detailUrl: "https://skills.test/tests.md",
};
const DOCS_SKILL: MarketplaceSkill = {
  id: "athas.docs",
  title: "Docs keeper",
  description: "Keeps docs current",
  tags: ["docs"],
  content: "Update the docs",
};

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(extensionId?: string) {
  await act(async () =>
    root.render(extensionId ? <ExtensionDetails extensionId={extensionId} /> : <ExtensionsView />),
  );
  await flush();
}

const view = () => within(document.body);
const status = () => view().getByRole("status").textContent ?? "";
const card = (name: string) =>
  view()
    .getAllByRole("button")
    .find((element) => element.textContent?.includes(name) && element.tagName !== "BUTTON")!;

async function search(value: string) {
  await act(async () => {
    fireEvent.change(view().getByPlaceholderText("Search integrations..."), {
      target: { value },
    });
  });
  await flush();
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

function setSettings(patch: Partial<{ aiSkills: AIChatSkill[]; extensionsActiveTab: string }>) {
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, ...patch } }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.skills = [TESTS_SKILL, DOCS_SKILL];
  io.stored.clear();
  io.detail = "Write the failing test first";
  io.registryLoads = 0;
  setSettings({ aiSkills: [], extensionsActiveTab: "all" });
  const actions = useExtensionStore.getState().actions;
  useExtensionStore.setState({
    registryError: null,
    isLoadingRegistry: false,
    actions: {
      ...actions,
      loadAvailableExtensions: async () => {
        io.registryLoads++;
      },
    },
  } as never);
  vi.stubGlobal("fetch", async () =>
    io.detail === null ? new Response("gone", { status: 404 }) : new Response(io.detail),
  );
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
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
  setSettings({ aiSkills: [], extensionsActiveTab: "all" });
  vi.unstubAllGlobals();
});

describe("extensions view", () => {
  it("groups the catalog by category with a live count", async () => {
    await render();
    expect(status()).toMatch(/^\d+ integrations · \d+ installed/);
    expect(view().getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(card("Test writer")).toBeTruthy();
    expect(card("Claude Code")).toBeTruthy();
  });

  it("searches the catalog and clears an empty search", async () => {
    await render();
    await search("focused tests");
    expect(status()).toMatch(/^1 integration · /);
    await search("nothing matches this");
    expect(view().getByText("No integrations found")).toBeTruthy();
    await click(last(view().getAllByRole("button", { name: "Clear search" }))!);
    expect(view().queryByText("No integrations found")).toBeNull();
  });

  it("filters by category and remembers the choice", async () => {
    await render();
    await click(view().getByRole("tab", { name: "Skills" }));
    expect(useSettingsStore.getState().settings.extensionsActiveTab).toBe("skill");
    expect(status()).toMatch(/^2 integrations/);
    expect(view().queryByRole("heading", { name: "Agents" })).toBeNull();
  });

  it("opens an integration's details from its card", async () => {
    await render();
    await click(card("Docs keeper"));
    const buffer = last(useBufferStore.getState().buffers);
    expect(buffer).toMatchObject({ type: "extension", name: "Docs keeper" });
  });

  it("offers actions for an integration on right click", async () => {
    await render();
    await act(async () => {
      fireEvent.contextMenu(card("Docs keeper"), { clientX: 10, clientY: 10 });
    });
    await flush();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
  });

  it("explains a registry failure and retries", async () => {
    useExtensionStore.setState({ registryError: "Network unreachable" });
    await render();
    expect(view().getByText("Marketplace integrations could not load")).toBeTruthy();
    expect(view().getByText("Network unreachable")).toBeTruthy();
    await click(view().getByRole("button", { name: "Retry" }));
    expect(io.registryLoads).toBe(1);
  });

  it("loads a published skill's instructions when they are opened", async () => {
    await render(TESTS_SKILL.id);
    await click(view().getByRole("button", { name: "Skill instructions" }));
    expect(view().getByTestId("markdown").textContent).toBe("Write the failing test first");
  });

  it("explains instructions that cannot be loaded", async () => {
    io.detail = null;
    await render(TESTS_SKILL.id);
    await click(view().getByRole("button", { name: "Skill instructions" }));
    expect(view().getByText("Could not load these skill instructions.")).toBeTruthy();
  });

  it("returns to the catalog or a category from the breadcrumb", async () => {
    setSettings({ extensionsActiveTab: "theme" });
    await render(DOCS_SKILL.id);
    await click(view().getByRole("button", { name: "Skills" }));
    expect(useSettingsStore.getState().settings.extensionsActiveTab).toBe("skill");
    expect(last(useBufferStore.getState().buffers)?.type).toBe("extensions");

    await click(view().getByRole("button", { name: "Integrations" }));
    expect(useSettingsStore.getState().settings.extensionsActiveTab).toBe("all");
  });

  it("edits an installed skill in the skills editor", async () => {
    setSettings({
      aiSkills: [
        {
          id: "installed-docs",
          title: "Docs keeper",
          content: "Update the docs",
          source: "marketplace",
          sourceId: DOCS_SKILL.id,
          createdAt: "2026-10-01T00:00:00Z",
          updatedAt: "2026-10-01T00:00:00Z",
        },
      ],
    });
    await render("installed-docs");
    await click(view().getByRole("button", { name: "Edit" }));
    expect((view().getByLabelText("Title") as HTMLInputElement).value).toBe("Docs keeper");
    await click(view().getByRole("button", { name: "Cancel" }));
    await click(view().getByRole("button", { name: "Close command palette" }));
    expect(view().queryByLabelText("Title")).toBeNull();
  });
});
