// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const toasts = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return [] as { type: string; message: string }[];
});

vi.mock("sonner", () => {
  const record = (type: string) => (message: string) => toasts.push({ type, message });
  return {
    toast: Object.assign(record("info"), {
      error: record("error"),
      success: record("success"),
      info: record("info"),
      warning: record("warning"),
    }),
  };
});

import { commands, type IdeRecentProject } from "@/bindings/commands";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { IdeSettingsImportDialog } from "../components/ide-settings-import-dialog";
import { useRecentFoldersStore } from "../stores/recent-folders.store";

enableMapSet();

let root: Root;
let container: HTMLDivElement;
let onClose = vi.fn<() => void>();

const body = () => within(document.body);

function project(sourceId: string, sourceName: string, path: string): IdeRecentProject {
  return { name: path.split("/").pop() ?? path, sourceId, sourceName, path };
}

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
  });
}

async function render() {
  await act(async () => root.render(<IdeSettingsImportDialog onClose={onClose} />));
  await flush();
}

async function key(element: Element, value: string) {
  await act(async () => {
    fireEvent.keyDown(element, { key: value });
  });
}

const sourceInput = () => body().getByPlaceholderText("Import from...");
const optionInput = () => body().getByPlaceholderText("Import what...");
const recentPaths = () => useRecentFoldersStore.getState().recentFolders.map((item) => item.path);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useRecentFoldersStore.setState({ recentFolders: [] });
  toasts.length = 0;
  onClose = vi.fn<() => void>();
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("IDE settings import dialog", () => {
  it("imports recent projects from every VS Code flavor", async () => {
    vi.spyOn(commands, "getImportableIdeProjects").mockResolvedValue([
      project("vscode", "VS Code", "/work/api"),
      project("vscodium", "VSCodium", "/work/web"),
      project("cursor", "Cursor", "/work/cursor-only"),
    ]);
    await render();

    await act(async () => button("VS Code").click());
    expect(optionInput()).toBeTruthy();
    expect(button("Recent Projects")).toBeTruthy();

    await act(async () => button("Import").click());

    expect(recentPaths().sort()).toEqual(["/work/api", "/work/web"]);
    expect(toasts).toContainEqual({
      type: "success",
      message: "Imported selected settings from VS Code",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("tells the user when the chosen editor has no recent projects", async () => {
    vi.spyOn(commands, "getImportableIdeProjects").mockResolvedValue([
      project("vscode", "VS Code", "/work/api"),
    ]);
    await render();

    await act(async () => {
      fireEvent.change(sourceInput(), { target: { value: "zed" } });
    });
    expect(body().queryByText("VS Code")).toBeNull();
    await key(sourceInput(), "Enter");
    await act(async () => button("Import").click());

    expect(toasts).toContainEqual({ type: "info", message: "No recent projects found in Zed" });
    expect(recentPaths()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables import once every option is unchecked", async () => {
    vi.spyOn(commands, "getImportableIdeProjects").mockResolvedValue([
      project("jetbrains", "IntelliJ IDEA", "/work/kotlin"),
    ]);
    await render();

    await key(sourceInput(), "ArrowDown");
    await key(sourceInput(), "ArrowDown");
    await key(sourceInput(), "ArrowUp");
    await key(sourceInput(), "Enter");
    expect(optionInput()).toBeTruthy();
    await key(optionInput(), "Enter");

    const importButton = button("Import");
    expect(importButton.disabled).toBe(true);
    await act(async () => importButton.click());
    expect(toasts).toEqual([]);

    await act(async () => button("Recent Projects").click());
    expect(button("Import").disabled).toBe(false);
  });

  it("filters import options and reports when nothing matches", async () => {
    vi.spyOn(commands, "getImportableIdeProjects").mockResolvedValue([]);
    await render();

    await act(async () => {
      fireEvent.change(sourceInput(), { target: { value: "emacs" } });
    });
    expect(body().getByText('No import source matches "emacs".')).toBeTruthy();
    await key(sourceInput(), "ArrowDown");
    await key(sourceInput(), "Enter");
    expect(body().queryByPlaceholderText("Import what...")).toBeNull();

    await act(async () => {
      fireEvent.change(sourceInput(), { target: { value: "" } });
    });
    await act(async () => button("Windsurf").click());
    await act(async () => {
      fireEvent.change(optionInput(), { target: { value: "keybindings" } });
    });
    expect(body().getByText('No import option matches "keybindings".')).toBeTruthy();
    await key(optionInput(), "Enter");
    expect(button("Import").disabled).toBe(false);

    await act(async () => {
      fireEvent.change(optionInput(), { target: { value: "recent" } });
    });
    expect(button("Recent Projects")).toBeTruthy();
  });

  it("shows an error when installed editors cannot be scanned", async () => {
    vi.spyOn(commands, "getImportableIdeProjects").mockRejectedValue("disk unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();

    expect(body().getByText("Could not scan installed editors: disk unavailable")).toBeTruthy();
  });

  it("shows a scanning state until editors are listed", async () => {
    vi.spyOn(commands, "getImportableIdeProjects").mockReturnValue(new Promise(() => {}));
    await render();

    expect(body().getByText("Scanning installed editors...")).toBeTruthy();
  });
});
