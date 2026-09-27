import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  homeDir: vi.fn(async () => "/Users/me"),
  readFileContent: vi.fn(),
  openBuffer: vi.fn(() => "buffer-1"),
  setActiveBuffer: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ homeDir: mocks.homeDir }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/features/file-system/controllers/file-operations", () => ({
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: { openBuffer: mocks.openBuffer, setActiveBuffer: mocks.setActiveBuffer },
    }),
  },
}));
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: "/work/project" }) },
}));

import {
  openToolPath,
  resolveToolPath,
  resolveWorkspacePath,
} from "@/features/ai/lib/open-tool-location";

describe("tool call paths", () => {
  beforeEach(() => {
    mocks.readFileContent.mockReset();
    mocks.openBuffer.mockClear();
    mocks.toastError.mockClear();
  });

  it("joins relative paths to the workspace root", () => {
    expect(resolveWorkspacePath("src/a.ts")).toBe("/work/project/src/a.ts");
    expect(resolveWorkspacePath("/abs/a.ts")).toBe("/abs/a.ts");
  });

  it("resolves home-relative paths against the home directory, never the root", async () => {
    expect(resolveWorkspacePath("~/notes/.envrc", "/Users/me")).toBe("/Users/me/notes/.envrc");
    expect(resolveWorkspacePath("~/notes/.envrc")).toBe("~/notes/.envrc");
    await expect(resolveToolPath("~/notes/.envrc")).resolves.toBe("/Users/me/notes/.envrc");
  });

  it("reports a file that cannot be read instead of rejecting", async () => {
    mocks.readFileContent.mockRejectedValue(new Error("No such file or directory"));

    await expect(openToolPath("missing.ts")).resolves.toBeUndefined();

    expect(mocks.openBuffer).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Could not open missing.ts", {
      description: "No such file or directory",
    });
  });
});
