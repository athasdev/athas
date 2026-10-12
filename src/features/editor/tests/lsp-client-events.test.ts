import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { LspClient } from "../lsp/services/lsp-client";
import { useLspStore } from "../lsp/stores/lsp.store";
import { useBufferStore } from "../stores/buffer.store";

const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
const registry = vi.hoisted(() => ({
  servers: new Map<string, string>(),
  languages: new Map<string, string>(),
}));

const extensionOf = (filePath: string) => filePath.slice(filePath.lastIndexOf(".") + 1);

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    events.handlers.set(name, handler);
    return () => events.handlers.delete(name);
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: {
    getExtensionForFilePath: () => ({ manifest: { id: "lang" } }),
    getLspServerPath: (filePath: string) => registry.servers.get(extensionOf(filePath)) ?? null,
    getLspServerArgs: () => ["--stdio"],
    getLanguageId: (filePath: string) => registry.languages.get(extensionOf(filePath)) ?? null,
    getLspInitializationOptions: () => ({ preferences: {} }),
  },
}));
vi.mock("@/extensions/runtime/language-tool-config", () => ({
  getLanguageToolConfigSet: () => ({ formatter: null }),
}));
vi.mock("@/extensions/registry/extension-store", () => ({
  waitForExtensionStoreInitialization: async () => {},
  useExtensionStore: {
    getState: () => ({ actions: { getExtensionForFile: () => null } }),
    setState: vi.fn(),
  },
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

function emit(name: string, payload: unknown) {
  const handler = events.handlers.get(name);
  if (!handler) throw new Error(`No listener for ${name}`);
  handler({ payload });
}

function lspDiagnostic(message: string, severity = 1) {
  return {
    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
    message,
    severity,
    source: "tsc",
    code: 2322,
  };
}

function editor(path: string, content: string): EditorContent {
  return {
    id: path,
    type: "editor",
    path,
    name: path.split("/").pop()!,
    content,
    savedContent: content,
    isDirty: false,
    isVirtual: false,
    language: "typescript",
  };
}

const diagnosticsFor = (filePath: string) =>
  useDiagnosticsStore.getState().actions.getDiagnosticsForFile(filePath);
const lspStatus = () => useLspStore.getState().lspStatus;

beforeEach(async () => {
  await vi.waitFor(() => expect(events.handlers.size).toBe(3));
  workspaceRuntimeRegistry.resetForTests();
  registry.servers.clear();
  registry.languages.clear();
  registry.servers.set("ts", "/bin/tsserver");
  registry.languages.set("ts", "typescript");
  registry.languages.set("md", "markdown");
  internals.activeLanguageServers.clear();
  internals.activeLanguages.clear();
  internals.activeServerFiles.clear();
  internals.failedLanguageServers.clear();
  internals.openDocuments.clear();
  internals.backendOpenedDocuments.clear();
  internals.documentVersions.clear();
  useDiagnosticsStore.getState().actions.clearAllDiagnostics();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("published diagnostics", () => {
  it("stores diagnostics for open documents", () => {
    internals.openDocuments.add("/ws/a.ts");

    emit("lsp://diagnostics", {
      uri: "file:///ws/a.ts",
      diagnostics: [lspDiagnostic("Type mismatch"), lspDiagnostic("Unused", 2)],
    });

    expect(diagnosticsFor("/ws/a.ts")).toEqual([
      expect.objectContaining({
        severity: "error",
        line: 2,
        column: 4,
        endColumn: 9,
        message: "Type mismatch",
        code: "2322",
      }),
      expect.objectContaining({ severity: "warning", message: "Unused" }),
    ]);
  });

  it("accepts diagnostics for a file open in a buffer before the server opened it", () => {
    useBufferStore.setState({ buffers: [editor("/ws/b.ts", "let b = 1;")] });

    emit("lsp://diagnostics", { uri: "file:///ws/b.ts", diagnostics: [lspDiagnostic("oops")] });

    expect(diagnosticsFor("/ws/b.ts")).toHaveLength(1);
  });

  it("clears diagnostics when the server publishes none", () => {
    internals.openDocuments.add("/ws/a.ts");
    emit("lsp://diagnostics", { uri: "file:///ws/a.ts", diagnostics: [lspDiagnostic("x")] });

    emit("lsp://diagnostics", { uri: "file:///ws/a.ts", diagnostics: null });

    expect(diagnosticsFor("/ws/a.ts")).toEqual([]);
  });

  it("ignores closed documents, stale versions and malformed events", () => {
    internals.openDocuments.add("/ws/a.ts");
    internals.documentVersions.set("/ws/a.ts", 5);

    emit("lsp://diagnostics", { uri: "file:///ws/closed.ts", diagnostics: [lspDiagnostic("x")] });
    emit("lsp://diagnostics", {
      uri: "file:///ws/a.ts",
      version: 4,
      diagnostics: [lspDiagnostic("stale")],
    });
    emit("lsp://diagnostics", null);
    emit("lsp://diagnostics", { diagnostics: [] });

    expect(diagnosticsFor("/ws/closed.ts")).toEqual([]);
    expect(diagnosticsFor("/ws/a.ts")).toEqual([]);

    emit("lsp://diagnostics", {
      uri: "file:///ws/a.ts",
      version: 5,
      diagnostics: [lspDiagnostic("current")],
    });
    expect(diagnosticsFor("/ws/a.ts").map((d) => d.message)).toEqual(["current"]);
  });
});

describe("server crashes", () => {
  it("reports the crash and restarts tracked servers after a delay", async () => {
    vi.useFakeTimers();
    await client.startForFile("/ws/a.ts", "/ws");
    vi.mocked(commands.lspStartForFile).mockClear();

    emit("lsp://server-crashed", {});

    expect(lspStatus().lastError).toBe("Language server crashed");
    expect(commands.lspStartForFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(commands.lspStartForFile).toHaveBeenCalledTimes(1));
    expect(commands.lspStopForFile).toHaveBeenCalledWith("/ws/a.ts");
    expect(lspStatus().status).toBe("connected");
  });

  it("survives a failed automatic restart", async () => {
    vi.useFakeTimers();
    await client.startForFile("/ws/a.ts", "/ws");
    vi.mocked(commands.lspStartForFile).mockRejectedValueOnce(
      Object.assign(new Error("binary gone"), { code: "other" }),
    );

    emit("lsp://server-crashed", {});
    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => expect(lspStatus().lastError).toBe("binary gone"));
  });
});

describe("server workspace edits", () => {
  it("rejects malformed edits and still acknowledges them", async () => {
    const respond = vi.spyOn(commands, "lspRespondWorkspaceEdit").mockResolvedValue(null as never);

    emit("lsp://workspace-edit", {
      clientId: "c1",
      ownerToken: "t1",
      requestId: 7,
      edit: { changes: "nope" },
    });

    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith(
        "c1",
        7,
        false,
        "Language server returned an unsupported workspace edit",
        null,
      ),
    );
  });

  it("tolerates a failed acknowledgement", async () => {
    const respond = vi
      .spyOn(commands, "lspRespondWorkspaceEdit")
      .mockRejectedValue(new Error("client gone"));

    emit("lsp://workspace-edit", { clientId: "c1", ownerToken: "t1", requestId: 1, edit: {} });

    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
  });
});

describe("workspace start", () => {
  it("starts the file's server once per workspace and tracks the file", async () => {
    await client.start("/ws", "/ws/a.ts");
    await client.start("/ws", "/ws/a.ts");

    expect(commands.lspStart).toHaveBeenCalledTimes(1);
    expect(commands.lspStart).toHaveBeenCalledWith(
      "/ws",
      "/bin/tsserver",
      ["--stdio"],
      "typescript",
      { formatter: null },
      { preferences: {} },
      expect.any(String),
    );
    expect(client.isWorkspaceActive("/ws")).toBe(true);
    expect(client.isWorkspaceActive("/other")).toBe(false);
    expect(client.getActiveWorkspaces()).toEqual(["/ws"]);
    expect(client.getActiveServerEntryForFile("/ws/a.ts", "typescript")?.key).toBe(
      "/ws:typescript",
    );
  });

  it("skips WSL workspaces and files without a configured server", async () => {
    await client.start("wsl://Ubuntu/ws", "wsl://Ubuntu/ws/a.ts");
    await client.start("/ws", "/ws/readme.md");
    await client.start("/ws", "/ws/data.bin");
    await client.start("/ws");

    expect(commands.lspStart).not.toHaveBeenCalled();
    expect(client.getActiveWorkspaces()).toEqual([]);
  });

  it("rethrows a failed start without tracking the server", async () => {
    vi.mocked(commands.lspStart).mockRejectedValueOnce(new Error("spawn failed"));

    await expect(client.start("/ws", "/ws/a.ts")).rejects.toThrow("spawn failed");
    expect(client.isWorkspaceActive("/ws")).toBe(false);
  });
});

describe("stopping and restarting", () => {
  it("rethrows stop failures", async () => {
    vi.mocked(commands.lspStop).mockRejectedValueOnce(new Error("stop failed"));
    vi.mocked(commands.lspStopForFile).mockRejectedValueOnce(new Error("stop file failed"));

    await expect(client.stop("/ws")).rejects.toThrow("stop failed");
    await expect(client.stopForFile("/ws/a.ts")).rejects.toThrow("stop file failed");
  });

  it("stops a tracked server through its file, or its workspace when no file is tracked", async () => {
    await client.startForFile("/ws/a.ts", "/ws");

    await client.stopTrackedServer("/ws:typescript");
    expect(commands.lspStopForFile).toHaveBeenCalledWith("/ws/a.ts");
    expect(client.getActiveServerEntries()).toEqual([]);
    expect(lspStatus().status).toBe("disconnected");

    internals.activeLanguageServers.add("/other:typescript");
    await client.stopTrackedServer("/other:typescript");
    expect(commands.lspStop).toHaveBeenCalledWith("/other");
    expect(client.getActiveServerEntries()).toEqual([]);
  });

  it("keeps the language listed while another workspace still serves it", async () => {
    await client.startForFile("/ws/a.ts", "/ws");
    await client.startForFile("/other/b.ts", "/other");

    await client.stopForFile("/ws/a.ts");

    expect(lspStatus()).toMatchObject({
      status: "connected",
      activeWorkspaces: ["/other"],
      supportedLanguages: ["TypeScript"],
    });
  });

  it("restarts a file's server and reopens it with the buffer text", async () => {
    await client.startForFile("/ws/a.ts", "/ws");
    useBufferStore.setState({ buffers: [editor("/ws/a.ts", "let a = 2;")] });

    await client.restartTrackedServer("/ws:typescript");

    expect(commands.lspStopForFile).toHaveBeenCalledWith("/ws/a.ts");
    expect(commands.lspDocumentOpen).toHaveBeenCalledWith("/ws/a.ts", "let a = 2;", "typescript");
    expect(client.isDocumentOpen("/ws/a.ts")).toBe(true);
    expect(lspStatus().status).toBe("connected");
  });

  it("reports a restart that cannot start the server", async () => {
    await expect(client.restartForFile("wsl://Ubuntu/a.ts", "wsl://Ubuntu", "")).rejects.toThrow(
      "Language server failed to start.",
    );
    expect(lspStatus().lastError).toBe("Language server failed to start.");
  });

  it("explains missing tools with a repair hint", async () => {
    vi.mocked(commands.lspStartForFile).mockRejectedValueOnce({
      message: "typescript-language-server was not found.",
      code: "tool_not_found",
    });

    await expect(client.startForFile("/ws/a.ts", "/ws")).rejects.toMatchObject({
      code: "tool_not_found",
    });
    expect(lspStatus().lastError).toBe(
      "typescript-language-server was not found. Open Integrations and reinstall the language tools.",
    );

    vi.mocked(commands.lspStartForFile).mockRejectedValueOnce({
      message: "Permission denied.",
      code: "tool_not_executable",
    });
    await expect(client.startForFile("/ws/a.ts", "/ws", { forceRetry: true })).rejects.toBeTruthy();
    expect(lspStatus().lastError).toBe(
      "Permission denied. The installed binary is present but cannot run.",
    );
  });

  it("reports a missing server binary for a known language", async () => {
    await expect(client.startForFile("/ws/readme.md", "/ws")).rejects.toThrow(
      "Language server for Markdown could not be resolved.",
    );
  });
});
