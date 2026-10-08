import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { LspClient } from "../lsp/services/lsp-client";
import { useLspStore } from "../lsp/stores/lsp.store";

const registry = vi.hoisted(() => ({
  servers: new Map<string, { path: string; languageId: string }>(),
  languages: new Map<string, string>(),
}));
const repair = vi.hoisted(() => ({
  extension: null as null | { isInstalled: boolean; manifest: Record<string, unknown> },
  resolveToolPaths: vi.fn(),
  registerExtension: vi.fn(),
}));

const extensionOf = (filePath: string) => filePath.slice(filePath.lastIndexOf(".") + 1);

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: {
    getExtensionForFilePath: () => undefined,
    getLspServerPath: (filePath: string) => registry.servers.get(extensionOf(filePath))?.path,
    getLspServerArgs: () => ["--stdio"],
    getLanguageId: (filePath: string) =>
      registry.servers.get(extensionOf(filePath))?.languageId ??
      registry.languages.get(extensionOf(filePath)),
    getLspInitializationOptions: () => undefined,
    registerExtension: (manifest: { lsp?: { server: string }; id: string }) => {
      repair.registerExtension(manifest);
      registry.servers.set("py", { path: manifest.lsp!.server, languageId: "python" });
    },
  },
}));
vi.mock("@/extensions/runtime/language-tool-config", () => ({
  getLanguageToolConfigSet: () => undefined,
}));
vi.mock("@/extensions/registry/extension-store", () => ({
  waitForExtensionStoreInitialization: async () => {},
  useExtensionStore: {
    getState: () => ({ actions: { getExtensionForFile: () => repair.extension } }),
    setState: vi.fn(),
  },
}));
vi.mock("@/extensions/runtime/language-tool-resolution", () => ({
  resolveToolPaths: repair.resolveToolPaths,
  buildRuntimeManifest: (manifest: Record<string, unknown>, toolPaths: { lsp?: string }) => ({
    ...manifest,
    lsp: toolPaths.lsp ? { server: toolPaths.lsp } : undefined,
  }),
}));

const client = LspClient.getInstance();
const internals = client as unknown as {
  activeLanguageServers: Set<string>;
  activeLanguages: Set<string>;
  activeServerFiles: Map<string, Set<string>>;
  failedLanguageServers: Set<string>;
  openDocuments: Set<string>;
  backendOpenedDocuments: Set<string>;
  documentVersions: Map<string, number>;
};

const lspStatus = () => useLspStore.getState().lspStatus;

beforeEach(() => {
  registry.servers.clear();
  registry.languages.clear();
  registry.servers.set("ts", { path: "/bin/tsserver", languageId: "typescript" });
  registry.servers.set("rs", { path: "/bin/rust-analyzer", languageId: "rust" });
  repair.extension = null;
  internals.activeLanguageServers.clear();
  internals.activeLanguages.clear();
  internals.activeServerFiles.clear();
  internals.failedLanguageServers.clear();
  internals.openDocuments.clear();
  internals.backendOpenedDocuments.clear();
  internals.documentVersions.clear();
  useLspStore.getState().actions.updateLspStatus("disconnected", [], undefined, []);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(commands, "lspStart").mockResolvedValue(null as never);
  vi.spyOn(commands, "lspStartForFile").mockResolvedValue(null as never);
  vi.spyOn(commands, "lspStop").mockResolvedValue(null as never);
  vi.spyOn(commands, "lspStopForFile").mockResolvedValue(null as never);
  vi.spyOn(commands, "lspDocumentOpen").mockResolvedValue(null as never);
  vi.spyOn(commands, "lspDocumentClose").mockResolvedValue(null as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("starting language servers for files", () => {
  it("starts a server once per workspace and language and tracks every file", async () => {
    await expect(client.startForFile("/ws/a.ts", "/ws")).resolves.toBe(true);
    await client.startForFile("/ws/b.ts", "/ws");

    expect(commands.lspStartForFile).toHaveBeenCalledWith(
      "/ws/a.ts",
      "/ws",
      "/bin/tsserver",
      ["--stdio"],
      "typescript",
      null,
      null,
      expect.any(String),
    );
    expect(client.getActiveServerEntries()).toEqual([
      {
        key: "/ws:typescript",
        workspacePath: "/ws",
        languageId: "typescript",
        displayName: "TypeScript",
        filePath: "/ws/a.ts",
      },
    ]);
    expect(client.getActiveServerEntryForFile("/ws/b.ts")?.key).toBe("/ws:typescript");
    expect(lspStatus()).toMatchObject({
      status: "connected",
      activeWorkspaces: ["/ws"],
      supportedLanguages: ["TypeScript"],
    });
  });

  it("skips host language servers for WSL files", async () => {
    await expect(client.startForFile("wsl://Ubuntu/home/a.ts", "wsl://Ubuntu/home")).resolves.toBe(
      false,
    );

    expect(commands.lspStartForFile).not.toHaveBeenCalled();
  });

  it("explains when a file type has no language server", async () => {
    await expect(client.startForFile("/ws/notes.txt", "/ws")).rejects.toThrow(
      "No language server is configured for this file.",
    );

    expect(lspStatus()).toMatchObject({
      status: "error",
      lastError: "No language server is configured for this file.",
    });
  });

  it("does not retry a server that failed until a forced retry", async () => {
    vi.mocked(commands.lspStartForFile).mockRejectedValueOnce(new Error("crashed"));

    await expect(client.startForFile("/ws/a.rs", "/ws")).rejects.toThrow("crashed");
    await expect(client.startForFile("/ws/b.rs", "/ws")).rejects.toThrow(
      "Rust language server previously failed to start.",
    );
    expect(commands.lspStartForFile).toHaveBeenCalledOnce();

    await expect(client.startForFile("/ws/b.rs", "/ws", { forceRetry: true })).resolves.toBe(true);
    expect(client.isWorkspaceActive("/ws")).toBe(true);
  });

  it("repairs missing language tools once and then starts the server", async () => {
    registry.languages.set("py", "python");
    repair.extension = { isInstalled: true, manifest: { id: "python", lsp: {} } };
    repair.resolveToolPaths.mockResolvedValue({
      toolPaths: { lsp: "/bin/pyright" },
      lspBundles: [],
      issues: [],
    });

    await expect(client.startForFile("/ws/main.py", "/ws")).resolves.toBe(true);

    expect(repair.resolveToolPaths).toHaveBeenCalledOnce();
    expect(repair.registerExtension).toHaveBeenCalledOnce();
    expect(commands.lspStartForFile).toHaveBeenCalledWith(
      "/ws/main.py",
      "/ws",
      "/bin/pyright",
      ["--stdio"],
      "python",
      null,
      null,
      expect.any(String),
    );
  });

  it("gives up when the language extension is not installed", async () => {
    registry.languages.set("py", "python");

    await expect(client.startForFile("/ws/main.py", "/ws")).rejects.toThrow(
      "Language server for Python could not be resolved.",
    );

    expect(repair.resolveToolPaths).not.toHaveBeenCalled();
  });
});

describe("stopping language servers", () => {
  it("keeps a server alive until its last tracked file stops", async () => {
    await client.startForFile("/ws/a.ts", "/ws");
    await client.startForFile("/ws/b.ts", "/ws");

    await client.stopForFile("/ws/a.ts");
    expect(client.isWorkspaceActive("/ws")).toBe(true);
    expect(client.getActiveServerEntryForFile("/ws/b.ts")?.filePath).toBe("/ws/b.ts");

    await client.stopForFile("/ws/b.ts");
    expect(client.isWorkspaceActive("/ws")).toBe(false);
    expect(lspStatus()).toMatchObject({ status: "disconnected", supportedLanguages: [] });
  });

  it("stops every server in a workspace and forgets its open documents", async () => {
    await client.startForFile("/ws/a.ts", "/ws");
    await client.startForFile("/ws/a.rs", "/ws");
    await client.startForFile("/other/a.ts", "/other");
    await client.notifyDocumentOpen("/ws/a.ts", "");
    await client.notifyDocumentOpen("/other/a.ts", "");

    await client.stop("/ws");

    expect(client.getActiveWorkspaces()).toEqual(["/other"]);
    expect(client.isDocumentOpen("/ws/a.ts")).toBe(false);
    expect(client.isDocumentOpen("/other/a.ts")).toBe(true);
  });

  it("keeps documents of a sibling workspace that shares the path prefix", async () => {
    await client.startForFile("/repo/app/a.ts", "/repo/app");
    await client.startForFile("/repo/app2/a.ts", "/repo/app2");
    await client.notifyDocumentOpen("/repo/app2/a.ts", "");

    await client.stop("/repo/app");

    expect(client.isWorkspaceActive("/repo/app2")).toBe(true);
    expect(client.isDocumentOpen("/repo/app2/a.ts")).toBe(true);
  });

  it("stops all workspaces", async () => {
    await client.startForFile("/ws/a.ts", "/ws");
    await client.startForFile("/other/a.ts", "/other");

    await client.stopAll();

    expect(commands.lspStop).toHaveBeenCalledTimes(2);
    expect(client.getActiveWorkspaces()).toEqual([]);
  });

  it("restarts a tracked server by reopening its representative file", async () => {
    await client.startForFile("/ws/a.ts", "/ws");
    await client.notifyDocumentOpen("/ws/a.ts", "");
    vi.mocked(commands.lspStartForFile).mockClear();

    await client.restartTrackedServer("/ws:typescript");

    expect(commands.lspDocumentClose).toHaveBeenCalledWith("/ws/a.ts");
    expect(commands.lspStopForFile).toHaveBeenCalledWith("/ws/a.ts");
    expect(commands.lspStartForFile).toHaveBeenCalledOnce();
    expect(client.isDocumentOpen("/ws/a.ts")).toBe(true);
  });

  it("refuses to restart a server without a tracked file", async () => {
    await expect(client.restartTrackedServer("/ws:typescript")).rejects.toThrow(
      "No tracked file for this language server",
    );
  });
});

describe("document lifecycle", () => {
  it("opens a document once even when asked concurrently", async () => {
    await Promise.all([
      client.notifyDocumentOpen("/ws/a.ts", "a"),
      client.notifyDocumentOpen("/ws/a.ts", "a"),
    ]);

    expect(commands.lspDocumentOpen).toHaveBeenCalledExactlyOnceWith("/ws/a.ts", "a", "typescript");
    expect(client.isDocumentOpen("/ws/a.ts")).toBe(true);
  });

  it("does not mark a document open when the backend rejects it", async () => {
    vi.mocked(commands.lspDocumentOpen).mockRejectedValueOnce(new Error("no server"));

    await client.notifyDocumentOpen("/ws/a.ts", "a");

    expect(client.isDocumentOpen("/ws/a.ts")).toBe(false);
  });

  it("closes a document that is still opening without leaving it open", async () => {
    let finishOpen: () => void = () => {};
    vi.mocked(commands.lspDocumentOpen).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpen = () => resolve(null as never);
        }),
    );

    const opening = client.notifyDocumentOpen("/ws/a.ts", "a");
    await vi.waitFor(() => expect(commands.lspDocumentOpen).toHaveBeenCalled());
    const closing = client.notifyDocumentClose("/ws/a.ts");
    finishOpen();
    await Promise.all([opening, closing]);

    expect(client.isDocumentOpen("/ws/a.ts")).toBe(false);
    expect(commands.lspDocumentClose).toHaveBeenCalledWith("/ws/a.ts");
  });

  it("only sends a close for documents the backend opened", async () => {
    await client.notifyDocumentClose("/ws/never-opened.ts");

    expect(commands.lspDocumentClose).not.toHaveBeenCalled();
  });
});

describe("requests", () => {
  it("returns empty results instead of throwing when a request fails", async () => {
    vi.spyOn(commands, "lspGetCompletions").mockRejectedValue(new Error("timeout"));
    vi.spyOn(commands, "lspGetHover").mockRejectedValue(new Error("timeout"));
    vi.spyOn(commands, "lspGetDefinition").mockRejectedValue(new Error("timeout"));

    await expect(client.getCompletions("/ws/a.ts", 0, 0)).resolves.toEqual([]);
    await expect(client.getHover("/ws/a.ts", 0, 0)).resolves.toBeNull();
    await expect(client.getDefinition("/ws/a.ts", 0, 0)).resolves.toBeNull();
  });

  it("keeps the original completion item when resolving fails", async () => {
    const item = { label: "map" };
    vi.spyOn(commands, "lspResolveCompletionItem").mockRejectedValue(new Error("unsupported"));

    await expect(client.resolveCompletionItem("/ws/a.ts", item)).resolves.toBe(item);
  });

  it("reports whether a file type has a language server", async () => {
    await expect(client.isLanguageSupported("/ws/a.ts")).resolves.toBe(true);
    await expect(client.isLanguageSupported("/ws/a.txt")).resolves.toBe(false);
  });
});
