import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/editor/lsp/lsp-store", () => ({
  useLspStore: {
    getState: () => ({
      actions: {
        setLspError: vi.fn(),
      },
    }),
  },
}));

vi.mock("@/ui/toast", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
import {
  buildMissingServerMessage,
  buildMissingServerStatusMessage,
  buildStartFailureMessage,
  buildStartFailureStatusMessage,
  buildWorkspacePathMessage,
  buildWorkspacePathStatusMessage,
  createLspStartupNotifier,
} from "./lsp-startup-reporting";

describe("lsp startup reporting", () => {
  it("formats missing-server messages with file context", () => {
    expect(
      buildMissingServerMessage({
        filePath: "/workspace/src/main.rs",
        languageId: "rust",
      }),
    ).toBe(
      "Could not start rust language server for main.rs because no server binary is configured or installed.",
    );
  });

  it("formats startup failures with the original error message", () => {
    expect(
      buildStartFailureMessage({
        filePath: "/workspace/src/app.ts",
        languageId: "typescript",
        error: new Error("spawn ENOENT"),
      }),
    ).toBe("Failed to start typescript language server for app.ts: spawn ENOENT");
  });

  it("formats missing-workspace messages", () => {
    expect(buildWorkspacePathMessage("/workspace/README.md")).toBe(
      "Could not start language server for README.md because no workspace path could be determined.",
    );
  });

  it("formats compact status messages for toolbar state", () => {
    expect(
      buildMissingServerStatusMessage({
        filePath: "/workspace/src/main.rs",
        languageId: "rust",
      }),
    ).toBe("rust language server unavailable for main.rs");

    expect(
      buildStartFailureStatusMessage({
        filePath: "/workspace/src/app.ts",
        languageId: "typescript",
        error: new Error("spawn ENOENT"),
      }),
    ).toBe("Failed to start typescript language server for app.ts");

    expect(buildWorkspacePathStatusMessage("/workspace/README.md")).toBe(
      "Language server unavailable for README.md",
    );
  });

  it("deduplicates repeated notifications for the same file issue", () => {
    const setError = vi.fn();
    const showError = vi.fn();
    const showWarning = vi.fn();
    const notifier = createLspStartupNotifier({
      setError,
      showError,
      showWarning,
    });

    notifier.reportMissingServer({
      filePath: "/workspace/main.go",
      languageId: "go",
    });
    notifier.reportMissingServer({
      filePath: "/workspace/main.go",
      languageId: "go",
    });

    expect(setError).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenNthCalledWith(1, "go language server unavailable for main.go");
    expect(setError).toHaveBeenNthCalledWith(2, "go language server unavailable for main.go");
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(
      "Could not start go language server for main.go because no server binary is configured or installed.",
    );
  });

  it("allows notifications again after a successful clear", () => {
    const notifier = createLspStartupNotifier({
      setError: vi.fn(),
      showError: vi.fn(),
      showWarning: vi.fn(),
    });

    notifier.reportMissingWorkspace("/workspace/src/lib.rs");
    notifier.clearForFile("/workspace/src/lib.rs");
    notifier.reportMissingWorkspace("/workspace/src/lib.rs");

    expect(notifier.reportMissingWorkspace("/workspace/src/lib.rs")).toBe(
      "Could not start language server for lib.rs because no workspace path could be determined.",
    );
  });
});
