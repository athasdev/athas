// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  activeBufferId: null as string | null,
  openUrl: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: harness.openUrl }));
vi.mock("@/features/editor/stores/buffer.store", async () => {
  const { create } = await import("zustand");
  return { useBufferStore: create(() => ({ buffers: [] as unknown[] })) };
});
vi.mock("@/features/workspace/stores/project.store", async () => {
  const { create } = await import("zustand");
  return {
    useProjectStore: create(() => ({
      projectName: "athas",
      rootFolderPath: "/projects/athas" as string | undefined,
    })),
  };
});
vi.mock("@/features/settings/stores/settings.store", async () => {
  const { create } = await import("zustand");
  return {
    useSettingsStore: create(() => ({
      settings: {
        showMinimap: false,
        wordWrap: true,
        lineNumbers: true,
        renderWhitespace: "none",
      },
    })),
  };
});
vi.mock("@/features/layout/stores/ui-state.store", async () => {
  const { create } = await import("zustand");
  return {
    useUIState: create(() => ({
      isSidebarVisible: true,
      isBottomPaneVisible: true,
      bottomPaneActiveTab: "terminal",
    })),
  };
});
vi.mock("@/features/panes/hooks/use-pane-buffer-state", () => ({
  useActiveBufferId: () => harness.activeBufferId,
}));

import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useExternalNavigationGuard } from "../hooks/use-external-navigation-guard";
import { useNativeMenuState } from "../hooks/use-native-menu-state";
import { useWindowDocumentState } from "../hooks/use-window-document-state";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type AnyStore = { setState: (state: object) => void };

function mount(useHook: () => void) {
  function Probe() {
    useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return () => act(() => root.unmount());
}

const editor = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  type: "editor",
  name: "main.ts",
  path: "/projects/athas/src/main.ts",
  isDirty: false,
  ...overrides,
});

beforeEach(() => {
  harness.activeBufferId = null;
  harness.openUrl.mockClear();
  (useBufferStore as unknown as AnyStore).setState({ buffers: [] });
  (useProjectStore as unknown as AnyStore).setState({
    projectName: "athas",
    rootFolderPath: "/projects/athas",
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWindowDocumentState", () => {
  it("names the window after the active file and project and marks unsaved edits", () => {
    const sync = vi.spyOn(commands, "setWindowDocumentState").mockResolvedValue(null);
    (useBufferStore as unknown as AnyStore).setState({ buffers: [editor()] });
    harness.activeBufferId = "b1";

    const unmount = mount(useWindowDocumentState);
    expect(sync).toHaveBeenLastCalledWith(
      "main.ts — athas — Athas",
      "/projects/athas/src/main.ts",
      false,
    );

    act(() =>
      (useBufferStore as unknown as AnyStore).setState({ buffers: [editor({ isDirty: true })] }),
    );
    expect(sync).toHaveBeenLastCalledWith(
      "main.ts — athas — Athas",
      "/projects/athas/src/main.ts",
      true,
    );
    unmount();
  });

  it("falls back to the app name and logs native failures", async () => {
    const sync = vi
      .spyOn(commands, "setWindowDocumentState")
      .mockRejectedValue(new Error("no window"));
    (useProjectStore as unknown as AnyStore).setState({ rootFolderPath: undefined });

    const unmount = mount(useWindowDocumentState);
    await Promise.resolve();
    await Promise.resolve();

    expect(sync).toHaveBeenCalledWith("Athas", null, false);
    expect(console.error).toHaveBeenCalledWith(
      "Failed to update native window document state:",
      new Error("no window"),
    );
    unmount();
  });
});

describe("useNativeMenuState", () => {
  it("syncs the menu with the editor, folder and panel state", () => {
    const sync = vi.spyOn(commands, "syncNativeMenuState").mockResolvedValue(null);
    (useBufferStore as unknown as AnyStore).setState({ buffers: [editor({ isDirty: true })] });
    harness.activeBufferId = "b1";

    const unmount = mount(useNativeMenuState);

    expect(sync).toHaveBeenLastCalledWith({
      closeFolderEnabled: true,
      saveEnabled: true,
      saveAsEnabled: true,
      sidebarVisible: true,
      terminalVisible: true,
      minimapVisible: false,
      wordWrap: true,
      lineNumbers: true,
      whitespaceVisible: false,
    });

    act(() => (useUIState as unknown as AnyStore).setState({ bottomPaneActiveTab: "diagnostics" }));
    expect(sync).toHaveBeenLastCalledWith(expect.objectContaining({ terminalVisible: false }));
    expect(sync).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("logs when the native menu cannot be updated", async () => {
    vi.spyOn(commands, "syncNativeMenuState").mockRejectedValue("menu missing");

    const unmount = mount(useNativeMenuState);
    await Promise.resolve();
    await Promise.resolve();

    expect(console.error).toHaveBeenCalledWith(
      "Failed to synchronize native menu state:",
      "menu missing",
    );
    unmount();
  });
});

describe("useExternalNavigationGuard", () => {
  function clickLink(href: string, init: MouseEventInit = {}, type = "click") {
    const link = document.createElement("a");
    link.setAttribute("href", href);
    const label = document.createElement("span");
    link.append(label);
    document.body.append(link);
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    label.dispatchEvent(event);
    link.remove();
    return event;
  }

  it("opens external links in the system browser instead of the app window", async () => {
    const unmount = mount(useExternalNavigationGuard);

    const external = clickLink("https://athas.dev/docs");
    await vi.waitFor(() => expect(harness.openUrl).toHaveBeenCalledWith("https://athas.dev/docs"));
    const middle = clickLink("mailto:hi@athas.dev", { button: 1 }, "auxclick");
    await vi.waitFor(() => expect(harness.openUrl).toHaveBeenCalledTimes(2));
    const internal = clickLink("#settings");
    const scripted = clickLink("javascript:alert(1)");

    expect(external.defaultPrevented).toBe(true);
    expect(middle.defaultPrevented).toBe(true);
    expect(internal.defaultPrevented).toBe(false);
    expect(scripted.defaultPrevented).toBe(false);
    expect(harness.openUrl).toHaveBeenCalledWith("mailto:hi@athas.dev");
    unmount();
  });

  it("leaves links that something else already handled", () => {
    const unmount = mount(useExternalNavigationGuard);
    const stop = (event: Event) => event.preventDefault();
    document.addEventListener("click", stop, true);

    clickLink("https://athas.dev");
    document.removeEventListener("click", stop, true);

    expect(harness.openUrl).not.toHaveBeenCalled();
    unmount();
  });

  it("routes window.open for web addresses to the system browser and restores it", async () => {
    const original = vi.fn(() => null);
    window.open = original as typeof window.open;
    const unmount = mount(useExternalNavigationGuard);

    expect(window.open("//cdn.example.com/a.js")).toBeNull();
    window.open("/local/page", "_self");
    expect(original).toHaveBeenCalledWith("/local/page", "_self", undefined);
    await vi.waitFor(() =>
      expect(harness.openUrl).toHaveBeenCalledWith("http://cdn.example.com/a.js"),
    );

    unmount();
    expect(window.open).toBe(original);
  });
});
