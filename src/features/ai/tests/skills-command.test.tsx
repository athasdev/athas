// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AIChatSkill, MarketplaceSkill } from "@/features/ai/types/skills.types";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useSettingsSyncStore } from "@/features/settings/stores/settings-sync.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { SkillsCommand, type SkillsView } from "../components/skills/skills-command";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    stored: new Map<string, unknown>(),
    marketplace: [] as MarketplaceSkill[],
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
  loadMarketplaceSkillContributions: async () => {
    io.registryLoads++;
    return io.marketplace;
  },
}));

const skill = (id: string, title: string, content: string, updatedAt: string): AIChatSkill => ({
  id,
  title,
  content,
  source: "local",
  createdAt: updatedAt,
  updatedAt,
});

const REVIEW = skill("review", "Code review", "Check   tests\nand naming", "2026-10-03T00:00:00Z");
const RELEASE = skill("release", "Release notes", "Summarize merged work", "2026-10-02T00:00:00Z");
const CATALOG: AIChatSkill = {
  ...skill("catalog", "Catalog skill", "Upstream text", "2026-10-01T00:00:00Z"),
  source: "marketplace",
  sourceId: "athas.catalog",
};

let root: Root;
let container: HTMLDivElement;
let selections: AIChatSkill[];
let closes: number;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(
  options: { isOpen?: boolean; initialSkillId?: string; initialView?: SkillsView } = {},
) {
  await act(async () =>
    root.render(
      <SkillsCommand
        isOpen={options.isOpen ?? true}
        initialSkillId={options.initialSkillId}
        initialView={options.initialView}
        onClose={() => closes++}
        onSelectSkill={(selected) => selections.push(selected)}
      />,
    ),
  );
  await flush();
}

const surface = () => within(document.body);
const rows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-command-surface] [role="button"]')].filter(
    (row) => row.querySelector("button") !== null,
  );
const rowTitles = () =>
  rows().map((row) => row.querySelector("span")?.textContent?.trim() ?? row.textContent);
const skills = () => useSettingsStore.getState().settings.aiSkills;
const button = (name: string) => surface().getByRole("button", { name });

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(document, { key });
  });
  await flush();
}

async function search(value: string) {
  const input = surface().getByRole("textbox");
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  await flush();
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await flush();
}

function setSkills(next: AIChatSkill[]) {
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, aiSkills: next } }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.stored.clear();
  io.marketplace = [];
  io.registryLoads = 0;
  selections = [];
  closes = 0;
  setSkills([RELEASE, REVIEW]);
  useSettingsSyncStore.setState({ enabled: false, status: "disabled" });
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  setSkills([]);
  vi.unstubAllGlobals();
});

describe("skills command", () => {
  it("lists saved skills newest first with a one-line preview", async () => {
    await render();
    expect(rowTitles()).toEqual(["Code review", "Release notes"]);
    expect(rows()[0].textContent).toContain("Check tests and naming");
    expect(surface().getByText("Not synced")).toBeTruthy();
  });

  it("does not render while closed", async () => {
    await render({ isOpen: false });
    expect(rows()).toHaveLength(0);
  });

  it("selects a skill from the keyboard and closes", async () => {
    await render();
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    await press("ArrowDown");
    await press("Enter");
    expect(selections.map((selected) => selected.id)).toEqual(["release"]);
    expect(closes).toBe(1);
  });

  it("selects a skill with the mouse and closes with Escape", async () => {
    await render();
    await act(async () => {
      fireEvent.mouseOver(rows()[1]);
    });
    await click(rows()[0]);
    expect(selections.map((selected) => selected.id)).toEqual(["review"]);

    await render({ isOpen: false });
    await render();
    closes = 0;
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    await flush();
    expect(closes).toBe(1);
  });

  it("filters skills by title and content", async () => {
    await render();
    await search("merged");
    expect(rowTitles()).toEqual(["Release notes"]);
    await search("zzzz");
    expect(surface().getByText('No skills match "zzzz"')).toBeTruthy();
    await press("Enter");
    expect(selections).toEqual([]);
  });

  it("shows an empty list when there are no skills", async () => {
    setSkills([]);
    await render();
    expect(surface().getByText("No skills yet")).toBeTruthy();
    await press("ArrowDown");
  });

  it("creates a new skill", async () => {
    await render();
    await click(button("New"));
    expect(surface().getByText("New skill")).toBeTruthy();
    const save = button("Save");
    expect(save.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      fireEvent.change(surface().getByLabelText("Title"), { target: { value: "  Triage  " } });
      fireEvent.change(surface().getByLabelText("Markdown"), {
        target: { value: "Label new issues" },
      });
    });
    await click(button("Save"));

    expect(skills()[0]).toMatchObject({
      title: "Triage",
      content: "Label new issues",
      source: "local",
    });
    expect(rowTitles()[0]).toBe("Triage");
  });

  it("edits and deletes an existing skill", async () => {
    await render();
    await click(button("Edit Release notes"));
    expect(surface().getByText("Edit skill")).toBeTruthy();
    expect((surface().getByLabelText("Title") as HTMLInputElement).value).toBe("Release notes");
    await act(async () => {
      fireEvent.change(surface().getByLabelText("Title"), { target: { value: "Changelog" } });
    });
    await click(button("Save"));
    expect(skills().find((entry) => entry.id === "release")?.title).toBe("Changelog");

    await click(button("Edit Changelog"));
    await click(button("Cancel"));
    expect(rowTitles()).toContain("Changelog");

    await click(button("Delete Changelog"));
    expect(skills().map((entry) => entry.id)).toEqual(["review"]);
    expect(rowTitles()).toEqual(["Code review"]);
  });

  it("opens straight into the editor for a requested skill or a new one", async () => {
    setSkills([CATALOG]);
    await render({ initialSkillId: "catalog" });
    expect(surface().getByText("Marketplace skill")).toBeTruthy();
    await act(async () => {
      fireEvent.change(surface().getByLabelText("Markdown"), { target: { value: "My text" } });
    });
    await click(button("Save"));
    expect(skills()[0]).toMatchObject({
      content: "My text",
      localOverride: true,
      upstreamContent: "Upstream text",
      upstreamTitle: "Catalog skill",
    });
    expect(surface().getByText("Local override")).toBeTruthy();
    expect(surface().getByText("Athas catalog")).toBeTruthy();

    await render({ isOpen: false });
    await render({ initialView: "editor" });
    expect(surface().getByText("New skill")).toBeTruthy();
  });

  it("browses published skills and adds one", async () => {
    io.marketplace = [
      {
        id: "athas.tests",
        title: "Write tests",
        description: "Adds focused tests",
        content: "Write a failing test first",
        version: "1.2.0",
        tags: ["testing", "quality", "ci", "extra"],
      },
      {
        id: "athas.docs",
        title: "Docs writer",
        description: "Keeps docs current",
        tags: ["docs"],
        detailUrl: "https://skills.test/docs.md",
      },
    ];
    vi.stubGlobal("fetch", async () => new Response("---\nname: docs\n---\nDocument each change"));
    await render();
    await click(button("Browse"));
    expect(rowTitles()).toEqual(["Docs writer", "Write tests"]);
    expect(rows()[1].textContent).toContain("v1.2.0");
    expect(rows()[1].textContent).toContain("ci");
    expect(rows()[1].textContent).not.toContain("extra");

    await search("focused");
    expect(rowTitles()).toEqual(["Write tests"]);
    await press("Enter");
    expect(skills()[0]).toMatchObject({ title: "Write tests", source: "marketplace" });
    expect(within(rows()[0]).getByRole("button", { name: "Added" })).toBeTruthy();
    await click(rows()[0]);
    expect(skills()).toHaveLength(3);

    await search("");
    await click(within(rows()[0]).getByRole("button", { name: "Add" }));
    expect(skills()[0]).toMatchObject({ title: "Docs writer", content: "Document each change" });

    await search("nothing");
    expect(surface().getByText('No available skills match "nothing"')).toBeTruthy();

    await search("");
    await click(button("My skills"));
    expect(rowTitles()).toContain("Docs writer");
  });

  it("explains an empty skills registry", async () => {
    await render({ initialView: "browse" });
    expect(surface().getByText("No published skills yet")).toBeTruthy();
    await flush();
    expect(io.registryLoads).toBe(1);
  });

  it("shows the sync state and opens account settings", async () => {
    useSettingsSyncStore.setState({ enabled: true, status: "syncing" });
    await render();
    expect(surface().getByText("Syncing")).toBeTruthy();
    await act(async () => useSettingsSyncStore.setState({ status: "error" }));
    expect(surface().getByText("Sync paused")).toBeTruthy();
    await act(async () => useSettingsSyncStore.setState({ status: "synced" }));
    await click(surface().getByText("Synced").closest("button")!);
    expect(closes).toBe(1);
    expect(useUIState.getState().isSettingsVisible).toBe(true);
    expect(useUIState.getState().settingsInitialTab).toBe("account");
  });
});
