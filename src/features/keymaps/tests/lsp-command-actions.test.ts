import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import {
  organizeJavaImports,
  refreshJavaProject,
  restartAllLanguageServers,
  stopAllLanguageServers,
} from "../commands/lsp-command-actions";

const lsp = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  restartAllTrackedServers: vi.fn(),
  stopAll: vi.fn(),
  entries: [] as Array<{ languageId: string; filePath: string | null }>,
}));
const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({
    readText: vi.fn().mockResolvedValue(""),
    writeText: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      executeCommand: lsp.executeCommand,
      restartAllTrackedServers: lsp.restartAllTrackedServers,
      stopAll: lsp.stopAll,
      getActiveServerEntries: () => lsp.entries,
    }),
  },
}));

const JAVA_PATH = "/ws/src/Main.java";
const JAVA_SOURCE = "import java.util.List;\nimport java.io.File;\nclass Main {}\n";

function editor(id: string, path: string, content: string): EditorContent {
  return {
    id,
    type: "editor",
    path,
    name: path.split("/").pop()!,
    content,
    savedContent: content,
    contentRevision: 0,
    isDirty: false,
    isVirtual: false,
    language: path.endsWith(".java") ? "java" : "typescript",
  };
}

function open(buffers: EditorContent[], activeId: string | null) {
  useBufferStore.setState({ buffers });
  seedActiveBuffer(activeId);
}

const contentOf = (id: string) =>
  (useBufferStore.getState().buffers.find((buffer) => buffer.id === id) as EditorContent).content;

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  lsp.entries = [];
  lsp.executeCommand.mockReset();
  lsp.restartAllTrackedServers.mockReset().mockResolvedValue(undefined);
  lsp.stopAll.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  vi.clearAllMocks();
});

describe("organize Java imports", () => {
  it("asks for a Java file when none is open or served", async () => {
    open([editor("ts", "/ws/a.ts", "const a = 1;")], "ts");

    await organizeJavaImports();

    expect(lsp.executeCommand).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Open a Java file to organize imports.");
  });

  it("applies the server's import edit to the open Java document", async () => {
    open([editor("java", JAVA_PATH, JAVA_SOURCE)], "java");
    lsp.executeCommand.mockResolvedValue({
      changes: {
        [`file://${JAVA_PATH}`]: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
            newText: "import java.io.File;\nimport java.util.List;\n",
          },
        ],
      },
    });

    await organizeJavaImports();

    expect(lsp.executeCommand).toHaveBeenCalledWith(JAVA_PATH, "java.edit.organizeImports", [
      `file://${JAVA_PATH}`,
    ]);
    expect(contentOf("java")).toBe("import java.io.File;\nimport java.util.List;\nclass Main {}\n");
    expect(toast.success).toHaveBeenCalledWith("Java imports organized.");
  });

  it("targets the Java file a running server tracks when the active tab is not Java", async () => {
    open([editor("ts", "/ws/a.ts", "x")], "ts");
    lsp.entries = [
      { languageId: "typescript", filePath: "/ws/a.ts" },
      { languageId: "java", filePath: null },
      { languageId: "java", filePath: "/ws/Other.java" },
    ];
    lsp.executeCommand.mockResolvedValue(null);

    await organizeJavaImports();

    expect(lsp.executeCommand).toHaveBeenCalledWith("/ws/Other.java", "java.edit.organizeImports", [
      "file:///ws/Other.java",
    ]);
    expect(contentOf("ts")).toBe("x");
    expect(toast.success).toHaveBeenCalled();
  });

  it("surfaces server failures", async () => {
    open([editor("java", JAVA_PATH, JAVA_SOURCE)], "java");
    lsp.executeCommand.mockRejectedValueOnce(new Error("jdtls is not ready"));
    await organizeJavaImports();
    expect(toast.error).toHaveBeenLastCalledWith("jdtls is not ready");

    lsp.executeCommand.mockRejectedValueOnce("boom");
    await organizeJavaImports();
    expect(toast.error).toHaveBeenLastCalledWith("Failed to organize Java imports.");
    expect(contentOf("java")).toBe(JAVA_SOURCE);
  });
});

describe("refresh Java project", () => {
  it("runs the project import command for the active Java file", async () => {
    open([editor("java", JAVA_PATH, JAVA_SOURCE)], "java");
    lsp.executeCommand.mockResolvedValue(null);

    await refreshJavaProject();

    expect(lsp.executeCommand).toHaveBeenCalledWith(JAVA_PATH, "java.project.import");
    expect(toast.success).toHaveBeenCalledWith("Java project refreshed.");
  });

  it("explains when there is no Java file and reports failures", async () => {
    open([], null);
    await refreshJavaProject();
    expect(toast.info).toHaveBeenCalledWith("Open a Java file to refresh its project.");

    open([editor("java", JAVA_PATH, JAVA_SOURCE)], "java");
    lsp.executeCommand.mockRejectedValueOnce(new Error("import failed"));
    await refreshJavaProject();
    expect(toast.error).toHaveBeenLastCalledWith("import failed");

    lsp.executeCommand.mockRejectedValueOnce(42);
    await refreshJavaProject();
    expect(toast.error).toHaveBeenLastCalledWith("Failed to refresh the Java project.");
  });
});

describe("restart and stop all language servers", () => {
  it("does nothing but inform when no server runs", async () => {
    await restartAllLanguageServers();
    await stopAllLanguageServers();

    expect(lsp.restartAllTrackedServers).not.toHaveBeenCalled();
    expect(lsp.stopAll).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith("No active language servers.");
  });

  it("restarts and stops running servers and reports the outcome", async () => {
    lsp.entries = [{ languageId: "typescript", filePath: "/ws/a.ts" }];

    await restartAllLanguageServers();
    expect(toast.success).toHaveBeenLastCalledWith("Language servers restarted.");

    await stopAllLanguageServers();
    expect(toast.success).toHaveBeenLastCalledWith("Language servers stopped.");

    lsp.restartAllTrackedServers.mockRejectedValueOnce(new Error("restart timed out"));
    await restartAllLanguageServers();
    expect(toast.error).toHaveBeenLastCalledWith("restart timed out");

    lsp.restartAllTrackedServers.mockRejectedValueOnce(null);
    await restartAllLanguageServers();
    expect(toast.error).toHaveBeenLastCalledWith("Failed to restart language servers.");

    lsp.stopAll.mockRejectedValueOnce(new Error("stop timed out"));
    await stopAllLanguageServers();
    expect(toast.error).toHaveBeenLastCalledWith("stop timed out");

    lsp.stopAll.mockRejectedValueOnce(undefined);
    await stopAllLanguageServers();
    expect(toast.error).toHaveBeenLastCalledWith("Failed to stop language servers.");
  });
});
