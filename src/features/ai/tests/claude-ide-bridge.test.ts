import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  answerClaudeIdeRequest,
  collectWorkspaceFolders,
} from "@/features/ai/integrations/claude-code/services/claude-ide-bridge";
import { runClaudeIdeTool } from "@/features/ai/integrations/claude-code/services/claude-ide-tools";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@/features/ai/integrations/claude-code/services/claude-ide-tools", () => ({
  runClaudeIdeTool: vi.fn(),
}));
vi.mock("@/features/ai/integrations/claude-code/services/claude-ide-diff-review", () => ({
  cancelClaudeDiff: vi.fn(),
}));
vi.mock("@/features/ai/integrations/claude-code/services/claude-ide-selection", () => ({
  isLocalFilePath: (path: string) => path.startsWith("/"),
  readActiveEditorSelection: () => null,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({ useBufferStore: {} }));
vi.mock("@/features/editor/stores/state.store", () => ({ useEditorStateStore: {} }));
vi.mock("@/features/settings/stores/settings.store", () => ({ useSettingsStore: {} }));
vi.mock("@/features/workspace/services/workspace-runtime-registry", () => ({
  workspaceRuntimeRegistry: {},
}));

function request(windowLabel = "main") {
  return { requestId: "r1", tool: "getOpenEditors", arguments: {}, windowLabel };
}

describe("Claude Code bridge", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(runClaudeIdeTool).mockReset();
  });

  it("answers requests addressed to this window with the tool's result", async () => {
    vi.mocked(runClaudeIdeTool).mockResolvedValue(['{"tabs":[]}']);
    await answerClaudeIdeRequest(request());
    expect(invoke).toHaveBeenCalledWith("respond_claude_ide_request", {
      requestId: "r1",
      answer: { content: ['{"tabs":[]}'], error: null },
    });
  });

  it("answers failures with the error message", async () => {
    vi.mocked(runClaudeIdeTool).mockRejectedValue(new Error("disk full"));
    await answerClaudeIdeRequest(request());
    expect(invoke).toHaveBeenCalledWith("respond_claude_ide_request", {
      requestId: "r1",
      answer: { content: [], error: "disk full" },
    });
  });

  it("leaves requests for other windows to them", async () => {
    await answerClaudeIdeRequest(request("secondary"));
    expect(runClaudeIdeTool).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("collects each local workspace folder once, roots first", () => {
    const folders = collectWorkspaceFolders([
      {
        rootFolderPath: "/repo/app",
        workspaceFolders: [
          { path: "/repo/app", name: "app" },
          { path: "/repo/lib", name: "lib" },
        ],
      },
      { rootFolderPath: "remote://host/srv", workspaceFolders: [] },
      { rootFolderPath: "/other", workspaceFolders: [{ path: "/repo/lib", name: "lib" }] },
    ] as never);
    expect(folders).toEqual(["/repo/app", "/other", "/repo/lib"]);
  });
});
