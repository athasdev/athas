import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { formatContent, formatRange, isFormattingAvailable } from "../services/formatter-service";
import { lintContent } from "../services/linter-service";

const lsp = vi.hoisted(() => ({
  formatDocument: vi.fn(),
  formatRange: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => lsp },
}));

const EXTENSION_IDS = ["test.fmtlang", "test.lintlang", "test.lsponly"];

function register(id: string, manifest: Record<string, unknown>, path = "/ext/" + id) {
  extensionRegistry.registerExtension({ id, name: id, displayName: id, ...manifest } as never, {
    path,
  });
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  register("test.fmtlang", {
    languages: [{ id: "fmtlang", extensions: [".fmtx"] }],
    formatter: {
      name: "fmt-tool",
      command: { default: "./bin/fmt" },
      args: ["--stdin"],
      inputMethod: "stdin",
      outputMethod: "stdout",
    },
    linter: {
      command: { default: "lint-tool" },
      diagnosticFormat: "regex",
      diagnosticPattern: "(?<line>\\d+)",
    },
  });
  register("test.lintlang", {
    languages: [{ id: "lintlang", extensions: [".lintx"] }],
    formatter: { command: { default: "" } },
  });
  register("test.lsponly", {
    languages: [{ id: "lsponly", extensions: [".lspx"] }],
    lsp: { server: { default: "/bin/lsponly-server" } },
  });
});

afterEach(() => {
  for (const id of EXTENSION_IDS) extensionRegistry.unregisterExtension(id);
  workspaceRuntimeRegistry.resetForTests();
  vi.restoreAllMocks();
  lsp.formatDocument.mockReset();
  lsp.formatRange.mockReset();
});

describe("formatContent", () => {
  it("runs the configured formatter in the project folder and returns its output", async () => {
    useProjectStore.setState({ rootFolderPath: "/ws" });
    const formatCode = vi
      .spyOn(commands, "formatCode")
      .mockResolvedValue({ success: true, formatted_content: "formatted", error: null } as never);

    await expect(formatContent({ filePath: "/ws/src/a.fmtx", content: "raw" })).resolves.toEqual({
      success: true,
      formattedContent: "formatted",
    });
    expect(formatCode).toHaveBeenCalledWith({
      content: "raw",
      language: "fmtlang",
      formatter: "fmt-tool",
      formatter_config: {
        command: "/ext/test.fmtlang/bin/fmt",
        args: ["--stdin"],
        env: null,
        input_method: "stdin",
        output_method: "stdout",
      },
      file_path: "/ws/src/a.fmtx",
      workspace_folder: "/ws",
    });
  });

  it("falls back to the language formatter and the file's folder without a project", async () => {
    useProjectStore.setState({ rootFolderPath: undefined });
    const formatCode = vi
      .spyOn(commands, "formatCode")
      .mockResolvedValue({ success: true, formatted_content: "ok", error: null } as never);

    await formatContent({ filePath: "/tmp/scratch.txt", content: "x", languageId: "fmtlang" });

    expect(formatCode).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "fmtlang",
        workspace_folder: "/tmp",
        file_path: "/tmp/scratch.txt",
      }),
    );
  });

  it("reports the formatter's own error, or a generic one", async () => {
    vi.spyOn(commands, "formatCode")
      .mockResolvedValueOnce({
        success: false,
        formatted_content: "",
        error: "syntax error",
      } as never)
      .mockResolvedValueOnce({ success: false, formatted_content: "", error: null } as never);

    await expect(formatContent({ filePath: "/ws/a.fmtx", content: "x" })).resolves.toEqual({
      success: false,
      error: "syntax error",
    });
    await expect(formatContent({ filePath: "/ws/a.fmtx", content: "x" })).resolves.toEqual({
      success: false,
      error: "Formatting failed",
    });
  });

  it("turns a failed native call into an error result", async () => {
    vi.spyOn(commands, "formatCode")
      .mockRejectedValueOnce(new Error("spawn ENOENT"))
      .mockRejectedValueOnce("crashed");

    await expect(formatContent({ filePath: "/ws/a.fmtx", content: "x" })).resolves.toEqual({
      success: false,
      error: "spawn ENOENT",
    });
    await expect(formatContent({ filePath: "/ws/a.fmtx", content: "x" })).resolves.toEqual({
      success: false,
      error: "crashed",
    });
  });

  it("formats through the language server when no formatter is configured", async () => {
    const formatCode = vi.spyOn(commands, "formatCode");
    lsp.formatDocument.mockResolvedValueOnce("from lsp");

    await expect(formatContent({ filePath: "/ws/a.lspx", content: "x" })).resolves.toEqual({
      success: true,
      formattedContent: "from lsp",
    });
    expect(lsp.formatDocument).toHaveBeenCalledWith("/ws/a.lspx", "x");
    expect(formatCode).not.toHaveBeenCalled();
  });

  it("explains when neither a formatter nor a language server can format", async () => {
    lsp.formatDocument.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("no server"));
    const expected = { success: false, error: "No formatter configured for this file type" };

    await expect(formatContent({ filePath: "/ws/a.unknown", content: "x" })).resolves.toEqual(
      expected,
    );
    await expect(formatContent({ filePath: "/ws/a.lintx", content: "x" })).resolves.toEqual(
      expected,
    );
  });

  it("refuses WSL files", async () => {
    const formatCode = vi.spyOn(commands, "formatCode");
    await expect(formatContent({ filePath: "wsl://Ubuntu/a.fmtx", content: "x" })).resolves.toEqual(
      { success: false, error: "Formatting is not available for WSL files." },
    );
    expect(formatCode).not.toHaveBeenCalled();
  });
});

describe("formatRange", () => {
  const range = { start: { line: 1, character: 0 }, end: { line: 2, character: 4 } };

  it("formats a range through the language server", async () => {
    lsp.formatRange.mockResolvedValueOnce("range done");

    await expect(formatRange({ filePath: "/ws/a.ts", content: "x", range })).resolves.toEqual({
      success: true,
      formattedContent: "range done",
    });
    expect(lsp.formatRange).toHaveBeenCalledWith("/ws/a.ts", "x", range);
  });

  it("reports when range formatting is unavailable", async () => {
    lsp.formatRange.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("down"));
    const expected = { success: false, error: "No range formatter configured for this file type" };

    await expect(formatRange({ filePath: "/ws/a.ts", content: "x", range })).resolves.toEqual(
      expected,
    );
    await expect(formatRange({ filePath: "/ws/a.ts", content: "x", range })).resolves.toEqual(
      expected,
    );
    await expect(
      formatRange({ filePath: "wsl://Ubuntu/a.ts", content: "x", range }),
    ).resolves.toEqual({
      success: false,
      error: "Range formatting is not available for WSL files.",
    });
  });
});

describe("isFormattingAvailable", () => {
  it("is available for formatter, language-server, and language-formatter files only", () => {
    expect(isFormattingAvailable("/ws/a.fmtx")).toBe(true);
    expect(isFormattingAvailable("/ws/a.lspx")).toBe(true);
    expect(isFormattingAvailable("/ws/a.unknown", "fmtlang")).toBe(true);
    expect(isFormattingAvailable("/ws/a.unknown", "lintlang")).toBe(false);
    expect(isFormattingAvailable("/ws/a.unknown")).toBe(false);
    expect(isFormattingAvailable("wsl://Ubuntu/a.fmtx")).toBe(false);
  });
});

describe("lintContent", () => {
  it("runs the configured linter and maps diagnostics", async () => {
    useProjectStore.setState({ rootFolderPath: "/ws" });
    const lintCode = vi.spyOn(commands, "lintCode").mockResolvedValue({
      success: true,
      error: null,
      diagnostics: [
        {
          line: 3,
          column: 1,
          end_line: 3,
          end_column: 9,
          severity: "warning",
          message: "unused",
          code: "W1",
          source: "lint-tool",
        },
        {
          line: 5,
          column: 2,
          end_line: null,
          end_column: null,
          severity: "fatal",
          message: "odd",
          code: null,
          source: null,
        },
      ],
    } as never);

    await expect(
      lintContent({ filePath: "/ws/a.fmtx", content: "src", languageId: "fmtlang" }),
    ).resolves.toEqual({
      success: true,
      diagnostics: [
        {
          line: 3,
          column: 1,
          endLine: 3,
          endColumn: 9,
          severity: "warning",
          message: "unused",
          code: "W1",
          source: "lint-tool",
        },
        {
          line: 5,
          column: 2,
          endLine: undefined,
          endColumn: undefined,
          severity: "info",
          message: "odd",
          code: undefined,
          source: undefined,
        },
      ],
    });
    expect(lintCode).toHaveBeenCalledWith({
      content: "src",
      language: "fmtlang",
      linter: "generic",
      linter_config: {
        command: "lint-tool",
        args: [],
        env: null,
        input_method: null,
        diagnostic_format: "regex",
        diagnostic_pattern: "(?<line>\\d+)",
      },
      file_path: "/ws/a.fmtx",
      workspace_folder: "/ws",
    });
  });

  it("uses the language linter and the registry's language id", async () => {
    useProjectStore.setState({ rootFolderPath: undefined });
    const lintCode = vi
      .spyOn(commands, "lintCode")
      .mockResolvedValue({ success: true, error: null, diagnostics: [] } as never);

    await lintContent({ filePath: "/a.unknown", content: "", languageId: "fmtlang" });
    expect(lintCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: "fmtlang", workspace_folder: null }),
    );

    await lintContent({ filePath: "/ws/b.fmtx", content: "" });
    expect(lintCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: "fmtlang", workspace_folder: "/ws" }),
    );
  });

  it("returns no diagnostics for files without a linter and for WSL files", async () => {
    const lintCode = vi.spyOn(commands, "lintCode");
    const clean = { success: true, diagnostics: [] };

    await expect(lintContent({ filePath: "/ws/a.lspx", content: "" })).resolves.toEqual(clean);
    await expect(lintContent({ filePath: "wsl://Ubuntu/a.fmtx", content: "" })).resolves.toEqual(
      clean,
    );
    expect(lintCode).not.toHaveBeenCalled();
  });

  it("reports linter failures without diagnostics", async () => {
    vi.spyOn(commands, "lintCode")
      .mockResolvedValueOnce({ success: false, error: "bad config", diagnostics: [] } as never)
      .mockResolvedValueOnce({ success: false, error: null, diagnostics: [] } as never)
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockRejectedValueOnce("gone");

    const lint = () => lintContent({ filePath: "/ws/a.fmtx", content: "" });
    await expect(lint()).resolves.toEqual({
      success: false,
      error: "bad config",
      diagnostics: [],
    });
    await expect(lint()).resolves.toEqual({
      success: false,
      error: "Linting failed",
      diagnostics: [],
    });
    await expect(lint()).resolves.toEqual({
      success: false,
      error: "spawn failed",
      diagnostics: [],
    });
    await expect(lint()).resolves.toEqual({ success: false, error: "gone", diagnostics: [] });
  });
});
