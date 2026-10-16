// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MenuActionItem, MenuItem } from "@/ui/dropdown";

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

const mocks = vi.hoisted(() => ({
  openCli: vi.fn(),
  signIn: vi.fn(async () => ({})),
  signOut: vi.fn(async () => ({})),
  openExtensionBuffer: vi.fn(),
}));

vi.mock("@/features/ai/services/open-agent-cli-in-terminal", () => ({
  openAgentCliInTerminal: mocks.openCli,
}));
vi.mock("@/features/ai/integrations/codex/codex-account-api", () => ({
  signInToCodex: mocks.signIn,
  signOutOfCodex: mocks.signOut,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ actions: { openExtensionBuffer: mocks.openExtensionBuffer } }),
  },
}));

import { agentMenuItems } from "@/features/ai/customize/components/agents-section";
import { extensionMenuItems } from "@/features/ai/customize/components/extensions-section";
import { McpSection, mcpServerMenuItems } from "@/features/ai/customize/components/mcp-section";
import { skillMenuItems } from "@/features/ai/customize/components/skills-section";
import { createMcpDraftFromCatalog } from "@/features/ai/customize/services/customize-catalog";
import { MCP_CATALOG } from "@/features/ai/customize/constants/mcp-catalog";
import type { CustomizeAgent } from "@/features/ai/customize/types/customize.types";
import { useAgentCatalogStore } from "@/features/ai/stores/agent-catalog.store";
import type { McpServerSetting } from "@/features/ai/types/mcp-server.types";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import type {
  ExtensionCatalogActions,
  UnifiedExtension,
} from "@/extensions/ui/components/extension-catalog-types";

const actionItems = (items: MenuItem[]) =>
  items.filter((item): item is MenuActionItem => item.separator !== true);
const labels = (items: MenuItem[]) => actionItems(items).map((item) => item.label);
const click = (items: MenuItem[], id: string) =>
  actionItems(items)
    .find((item) => item.id === id)
    ?.onClick?.();

const linear: McpServerSetting = {
  id: "l1",
  name: "linear",
  enabled: true,
  transport: "http",
  command: "",
  args: [],
  url: "https://mcp.linear.app/mcp",
};

function mcpEditor(servers: McpServerSetting[] = []) {
  return {
    servers,
    editor: null,
    openNew: vi.fn(),
    openEdit: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    close: vi.fn(),
  };
}

function customizeAgent(changes: Partial<CustomizeAgent>): CustomizeAgent {
  return {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "",
    isInstalled: true,
    canInstall: true,
    updateAvailable: false,
    isFeatured: true,
    isCodex: false,
    ...changes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MCP server rows", () => {
  it("turns a server off, edits it and removes it", () => {
    const editor = mcpEditor([linear]);
    const items = mcpServerMenuItems(linear, editor);
    expect(labels(items)).toEqual(["Turn off", "Edit…", "Remove"]);

    click(items, "enabled");
    click(items, "edit");
    click(items, "remove");
    expect(editor.setEnabled).toHaveBeenCalledWith(linear, false);
    expect(editor.openEdit).toHaveBeenCalledWith(linear);
    expect(editor.remove).toHaveBeenCalledWith(linear);
    expect(labels(mcpServerMenuItems({ ...linear, enabled: false }, editor))[0]).toBe("Turn on");
  });

  describe("rendered", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    it("adds a catalog server through the dialog, with its setup note", () => {
      const editor = mcpEditor([linear]);
      act(() =>
        root.render(
          <McpSection
            tab="catalog"
            query=""
            revealedItemId={null}
            editor={editor}
            onShowCatalog={vi.fn()}
          />,
        ),
      );
      const view = within(container);

      expect(view.queryByRole("button", { name: "Add Linear" })).toBeNull();
      expect(view.getByRole("button", { name: "Linear actions" })).toBeTruthy();

      fireEvent.click(view.getByRole("button", { name: "Add GitHub" }));
      const github = MCP_CATALOG.find((entry) => entry.id === "github");
      expect(editor.openNew).toHaveBeenCalledWith(
        createMcpDraftFromCatalog(github!),
        github?.setupNote,
      );
    });

    it("offers the catalog when nothing is installed", () => {
      const showCatalog = vi.fn();
      act(() =>
        root.render(
          <McpSection
            tab="installed"
            query=""
            revealedItemId={null}
            editor={mcpEditor()}
            onShowCatalog={showCatalog}
          />,
        ),
      );
      fireEvent.click(within(container).getByRole("button", { name: "Browse the catalog" }));
      expect(showCatalog).toHaveBeenCalled();
    });
  });
});

describe("agent rows", () => {
  it("updates, signs in through the CLI and uninstalls an installed agent", () => {
    const runAgentAction = vi.fn(async () => {});
    const actions = useAgentCatalogStore.getState().actions;
    useAgentCatalogStore.setState({ actions: { ...actions, runAgentAction } });

    const items = agentMenuItems(customizeAgent({ updateAvailable: true }));
    expect(labels(items)).toEqual(["Update", "Sign in with Gemini CLI", "Uninstall"]);
    click(items, "update");
    click(items, "sign-in");
    click(items, "uninstall");

    expect(runAgentAction).toHaveBeenCalledWith("gemini-cli", "Gemini CLI", "update");
    expect(runAgentAction).toHaveBeenCalledWith("gemini-cli", "Gemini CLI", "uninstall");
    expect(mocks.openCli).toHaveBeenCalledWith("gemini-cli");
    useAgentCatalogStore.setState({ actions });
  });

  it("signs in and out of Codex with its own account flow", () => {
    const items = agentMenuItems(customizeAgent({ id: "codex", name: "Codex", isCodex: true }));
    expect(labels(items)).toEqual(["Sign in with ChatGPT", "Sign out", "Codex settings…"]);
    click(items, "sign-in");
    click(items, "sign-out");
    expect(mocks.signIn).toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalled();
  });
});

describe("skill rows", () => {
  const actions = {
    edit: vi.fn(),
    update: vi.fn(),
    resetOverride: vi.fn(),
    remove: vi.fn(),
  };

  it("edits and deletes a personal skill", () => {
    const skill = { id: "s1", title: "Review", content: "x", source: "local" } as AIChatSkill;
    const items = skillMenuItems(skill, actions as never);
    expect(labels(items)).toEqual(["Edit…", "Delete"]);
    click(items, "edit");
    click(items, "remove");
    expect(actions.edit).toHaveBeenCalledWith(skill);
    expect(actions.remove).toHaveBeenCalledWith(skill);
  });

  it("offers the catalog update and the reset for an edited catalog skill", () => {
    const skill = {
      id: "s2",
      title: "Mine",
      content: "edited",
      source: "marketplace",
      sourceId: "docs",
      version: "1.0.0",
      upstreamTitle: "Docs",
      upstreamContent: "original",
    } as AIChatSkill;
    const marketplace: MarketplaceSkill = {
      id: "docs",
      title: "Docs",
      description: "",
      version: "2.0.0",
      tags: [],
    };
    const items = skillMenuItems(skill, actions as never, marketplace);
    expect(labels(items)).toEqual(["Edit…", "Update", "Reset to catalog version", "Remove"]);
    click(items, "update");
    expect(actions.update).toHaveBeenCalledWith(skill, marketplace);
  });
});

describe("extension rows", () => {
  it("opens details and turns off or uninstalls a marketplace extension", () => {
    const actions = {
      hasUpdate: () => true,
      update: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      uninstall: vi.fn(),
      applyAppearance: vi.fn(),
    } as unknown as ExtensionCatalogActions;
    const extension = {
      id: "athas.rust",
      name: "Rust",
      category: "language",
      isInstalled: true,
      isEnabled: true,
      isMarketplace: true,
    } as UnifiedExtension;

    const items = extensionMenuItems(extension, actions);
    expect(labels(items)).toEqual(["Details", "Update", "Turn off", "Uninstall"]);
    click(items, "details");
    click(items, "enabled");
    expect(mocks.openExtensionBuffer).toHaveBeenCalledWith("athas.rust", "Rust");
    expect(actions.deactivate).toHaveBeenCalledWith(extension);
  });
});
