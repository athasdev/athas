// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { ThemeSelectorContent } from "../components/theme-selector";

const storage = vi.hoisted(() => ({ data: new Map<string, unknown>() }));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => storage.data.get(key),
    set: async (key: string, value: unknown) => {
      storage.data.set(key, structuredClone(value));
    },
    save: async () => {},
  }),
}));

const COLORS = {
  background: "#101010",
  surface: "#181818",
  foreground: "#eeeeee",
  "muted-foreground": "#aaaaaa",
  "subtle-foreground": "#888888",
  border: "#333333",
  accent: "#222222",
  selected: "#2a2a2a",
  primary: "#3b82f6",
};

const THEMES = [
  { id: "dawn", name: "Dawn", description: "Warm light colors", category: "Light" as const },
  { id: "dusk", name: "Dusk", description: "", category: "Dark" as const },
  { id: "night", name: "Night", description: "Deep blue", category: "Dark" as const },
];

let root: Root;
let container: HTMLDivElement;
let committed: string[];
let closes: number;
let backs: number;
let pickedFile: File | null;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(isActive = true, currentTheme = "dusk") {
  await act(async () =>
    root.render(
      <ThemeSelectorContent
        isActive={isActive}
        currentTheme={currentTheme}
        onBack={() => backs++}
        onClose={() => closes++}
        onThemeChange={(theme) => committed.push(theme)}
      />,
    ),
  );
  await flush();
}

const view = () => within(container);
const input = () => view().getByRole("combobox");
const options = () => view().queryAllByRole("option");
const selectedName = () => {
  const option = options().find((candidate) => candidate.getAttribute("aria-selected") === "true");
  return THEMES.find((theme) => option?.textContent?.includes(theme.name))?.name ?? null;
};
const applied = () => document.documentElement.getAttribute("data-theme");

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(input(), { key });
  });
}

async function type(value: string) {
  await act(async () => {
    fireEvent.change(input(), { target: { value } });
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  storage.data.clear();
  committed = [];
  closes = 0;
  backs = 0;
  pickedFile = null;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    if (this.type !== "file" || !pickedFile) return;
    Object.defineProperty(this, "files", { value: [pickedFile] });
    this.onchange?.(new Event("change"));
  });
  for (const theme of THEMES) {
    themeRegistry.registerTheme({ ...theme, cssVariables: { "--background": theme.id } });
  }
  themeRegistry.applyTheme("dusk");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const theme of THEMES) themeRegistry.unregisterTheme(theme.id);
  themeRegistry.unregisterTheme("ocean");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme selector", () => {
  it("lists the themes with the current one marked and selected", async () => {
    await render();
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining("Dawn"),
      expect.stringContaining("Dusk"),
      expect.stringContaining("Night"),
    ]);
    expect(options()[0].textContent).toContain("Warm light colors");
    expect(options()[1].textContent).toContain("Dark");
    expect(options()[1].textContent).toContain("Current");
    expect(selectedName()).toBe("Dusk");
    expect(input().getAttribute("aria-activedescendant")).toBe("theme-selector-option-1");
  });

  it("previews themes while moving through the list and commits with Enter", async () => {
    await render();
    await press("ArrowDown");
    expect(selectedName()).toBe("Night");
    expect(applied()).toBe("night");
    await press("ArrowDown");
    expect(selectedName()).toBe("Dawn");
    await press("ArrowUp");
    expect(selectedName()).toBe("Night");
    await press("Home");
    expect(applied()).toBe("dawn");
    await press("End");
    expect(applied()).toBe("night");
    await press("Tab");
    expect(selectedName()).toBe("Night");

    await press("Enter");
    expect(committed).toEqual(["night"]);
    expect(closes).toBe(1);

    await act(async () => root.unmount());
    expect(applied()).toBe("night");
    root = createRoot(container);
  });

  it("restores the original theme when the user escapes after previewing", async () => {
    await render();
    await press("ArrowDown");
    expect(applied()).toBe("night");
    await press("Escape");
    expect(applied()).toBe("dusk");
    expect(committed).toEqual([]);
    expect(closes).toBe(1);
  });

  it("restores the original theme when the selector is deactivated or left", async () => {
    await render();
    await press("End");
    expect(applied()).toBe("night");
    await render(false);
    expect(applied()).toBe("dusk");

    await render(true);
    await press("Home");
    await act(async () => view().getByRole("button", { name: "Back to commands" }).click());
    expect(applied()).toBe("dusk");
    expect(backs).toBe(1);

    await press("Home");
    await act(async () => root.unmount());
    expect(applied()).toBe("dusk");
    root = createRoot(container);
  });

  it("filters themes by name, description or category", async () => {
    await render();
    await type("deep");
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining("Night"),
    ]);
    await type("light");
    expect(options()).toHaveLength(1);
    expect(selectedName()).toBe("Dawn");
    await type("nothing like this");
    expect(options()).toHaveLength(0);
    expect(view().getByText("No themes found")).toBeTruthy();
    await press("Enter");
    expect(committed).toEqual([]);
  });

  it("picks a theme with the mouse", async () => {
    await render();
    await act(async () => {
      fireEvent.mouseMove(options()[0]);
    });
    expect(selectedName()).toBe("Dawn");
    await act(async () => options()[2].click());
    expect(committed).toEqual(["night"]);
    expect(closes).toBe(1);
  });

  it("opens appearance settings", async () => {
    await render();
    await act(async () => view().getByRole("button", { name: "Open appearance settings" }).click());
    expect(closes).toBe(1);
    expect(useUIState.getState().isSettingsVisible).toBe(true);
    expect(useUIState.getState().settingsInitialTab).toBe("appearance");
  });

  it("imports an uploaded theme file and switches to it", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);
    pickedFile = new File(
      [
        JSON.stringify({
          name: "Ocean",
          themes: [{ id: "ocean", name: "Ocean", appearance: "dark", colors: COLORS }],
        }),
      ],
      "ocean.json",
      { type: "application/json" },
    );
    await render();
    await act(async () => view().getByRole("button", { name: "Upload theme" }).click());
    await flush();
    expect(success).toHaveBeenCalledWith("Imported Ocean");
    expect(committed).toEqual(["ocean"]);
    expect(closes).toBe(1);
    expect(options().some((option) => option.textContent?.includes("Ocean"))).toBe(true);
  });

  it("reports a theme file that cannot be imported", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 1);
    pickedFile = new File(["{}"], "ocean.txt");
    await render();
    await act(async () => view().getByRole("button", { name: "Upload theme" }).click());
    await flush();
    expect(error).toHaveBeenCalledWith("Choose an Athas theme JSON file.", {
      description: "ocean.txt does not use the .json extension",
    });
    expect(committed).toEqual([]);
  });
});
