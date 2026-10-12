// @vitest-environment jsdom
import { within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";

const toasts = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return [] as string[];
});

vi.mock("sonner", () => {
  const record = (message: string) => toasts.push(message);
  return { toast: Object.assign(record, { error: record, success: record, info: record }) };
});

const { extensionRegistry } = await import("@/extensions/registry/extension-registry");
const { EditorStatusActions } = await import("../components/toolbar/editor-status-actions");
const { LspClient } = await import("../lsp/services/lsp-client");
const { useLspStore } = await import("../lsp/stores/lsp.store");
const { useBufferStore } = await import("../stores/buffer.store");

enableMapSet();

const tsServer = {
  key: "/repo::typescript",
  workspacePath: "/repo",
  languageId: "typescript",
  displayName: "TypeScript",
  filePath: "/repo/src/app.ts",
};

let root: Root;
let container: HTMLDivElement;
let bufferId: string;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 3; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () => root.render(<EditorStatusActions bufferId={bufferId} />));
  await flush();
}

const body = () => within(document.body);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

function setLsp(
  status: "disconnected" | "connecting" | "connected" | "error",
  languages?: string[],
) {
  useLspStore.setState((state) => ({
    lspStatus: { ...state.lspStatus, status, supportedLanguages: languages },
  }));
}

async function openPreferences() {
  await click(body().getByRole("button", { name: "Editor preferences" }));
}

const checkbox = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
    (item) => item.textContent?.trim() === label,
  )!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  toasts.length = 0;
  useProjectStore.setState({ rootFolderPath: "/repo" });
  setLsp("disconnected");
  bufferId = useBufferStore
    .getState()
    .actions.openBuffer("/repo/src/app.ts", "app.ts", "export const app = 1;");
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("editor status actions", () => {
  it("names the file's language and switches it", async () => {
    await render();
    const language = body().getByRole("combobox", { name: "Language mode: TypeScript" });
    await click(language);
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "Python",
    )!;
    await click(option);
    const buffer = useBufferStore.getState().buffers.find((item) => item.id === bufferId);
    expect(buffer && "languageOverride" in buffer ? buffer.languageOverride : null).toBe("python");
    expect(body().getByRole("combobox", { name: "Language mode: Python" })).toBeTruthy();
  });

  it("explains each language server state", async () => {
    await render();
    await click(body().getByRole("button", { name: "Language server status" }));
    expect(body().getByText("No active language servers")).toBeTruthy();
    expect(body().getByText("repo")).toBeTruthy();

    await act(async () => setLsp("error"));
    expect(body().getByRole("alert").textContent).toContain("Language server issue");

    await act(async () => setLsp("connecting"));
    expect(body().getAllByText("Connecting").length).toBeGreaterThan(0);
  });

  it("restarts and stops running language servers", async () => {
    const lsp = LspClient.getInstance();
    vi.spyOn(lsp, "getActiveServerEntries").mockReturnValue([tsServer]);
    vi.spyOn(lsp, "getActiveServerEntryForFile").mockReturnValue(tsServer);
    const restart = vi.spyOn(lsp, "restartTrackedServer").mockResolvedValue();
    const stop = vi
      .spyOn(lsp, "stopTrackedServer")
      .mockRejectedValueOnce(new Error("Server is not responding"));
    const restartAll = vi.spyOn(lsp, "restartAllTrackedServers").mockResolvedValue();
    const stopAll = vi.spyOn(lsp, "stopAll").mockRejectedValue(new Error("Stop failed"));
    setLsp("connected", ["typescript"]);
    await render();
    await click(body().getByRole("button", { name: "Language server status" }));
    expect(within(body().getByRole("menu")).getByText("TypeScript")).toBeTruthy();

    await click(body().getByRole("button", { name: "Restart" }));
    expect(restart).toHaveBeenCalledWith("/repo::typescript");

    await click(body().getByRole("button", { name: "Stop TypeScript language server" }));
    expect(stop).toHaveBeenCalledWith("/repo::typescript");
    expect(toasts).toContain("Server is not responding");

    await click(body().getByRole("button", { name: "Restart all" }));
    expect(restartAll).toHaveBeenCalled();
    await click(body().getByRole("button", { name: "Stop all" }));
    expect(stopAll).toHaveBeenCalled();
    expect(toasts).toContain("Stop failed");
  });

  it("toggles editor display preferences", async () => {
    const before = useSettingsStore.getState().settings;
    await render();
    await openPreferences();
    await click(checkbox("Minimap"));
    expect(useSettingsStore.getState().settings.showMinimap).toBe(!before.showMinimap);

    await openPreferences();
    await click(checkbox("Breadcrumbs"));
    expect(useSettingsStore.getState().settings.coreFeatures.breadcrumbs).toBe(
      !before.coreFeatures.breadcrumbs,
    );

    for (const [label, key] of [
      ["Line Numbers", "lineNumbers"],
      ["Parameter Hints", "parameterHints"],
      ["Auto Completion", "autoCompletion"],
      ["Inlay Hints", "inlayHints"],
      ["Code Lens", "codeLens"],
      ["Semantic Tokens", "semanticTokens"],
      ["Vim Mode", "vimMode"],
      ["Inline Git Blame", "enableInlineGitBlame"],
    ] as const) {
      await openPreferences();
      await click(checkbox(label));
      expect(useSettingsStore.getState().settings[key]).toBe(!before[key]);
    }

    useSettingsStore.setState({ settings: before });
  });

  it("starts the language server for the current file", async () => {
    const lsp = LspClient.getInstance();
    vi.spyOn(extensionRegistry, "getLspServerPath").mockReturnValue("/bin/tsserver");
    vi.spyOn(lsp, "getActiveServerEntries").mockReturnValue([]);
    vi.spyOn(lsp, "getActiveServerEntryForFile").mockReturnValue(null);
    const start = vi
      .spyOn(lsp, "startForFile")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const notify = vi.spyOn(lsp, "notifyDocumentOpen").mockResolvedValue();
    await render();
    await click(body().getByRole("button", { name: "Language server status" }));

    await click(body().getByRole("button", { name: "Start" }));
    expect(start).toHaveBeenCalledWith("/repo/src/app.ts", "/repo", { forceRetry: true });
    expect(toasts).toContain("Language server did not start.");

    await click(body().getByRole("button", { name: "Start" }));
    expect(notify).toHaveBeenCalledWith("/repo/src/app.ts", "export const app = 1;");
  });
});
