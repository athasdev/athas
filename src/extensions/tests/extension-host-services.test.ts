import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  writeClipboardText: vi.fn(),
  toast: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ writeClipboardText: mocks.writeClipboardText }));
vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
    info: mocks.toastInfo,
  }),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: { getState: () => ({ activeBufferId: null, buffers: [] }) },
}));
vi.mock("@/features/git/api/git-remotes-api", () => ({ getRemotes: vi.fn() }));
vi.mock("@/features/git/stores/git-repository.store", () => ({
  useRepositoryStore: { getState: () => ({ activeRepoPath: null }) },
}));
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: null }) },
}));

import {
  callExtensionHostService,
  clearExtensionHostServiceState,
} from "../ui/services/extension-host-services";

const manifest = {
  id: "generated.status",
  name: "status",
  displayName: "Status",
  description: "Loads service status.",
  version: "0.0.0",
  publisher: "athas.generated",
  categories: ["UI"],
  permissions: { network: ["https://status.example.com"] },
} satisfies ExtensionManifest;

describe("extension host services", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.writeClipboardText.mockReset();
    mocks.toast.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastWarning.mockReset();
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
    clearExtensionHostServiceState(manifest.id);
  });

  it("does not follow redirects outside an allowed network origin", async () => {
    mocks.fetch.mockResolvedValue(new Response("moved", { status: 302 }));

    await callExtensionHostService("generated.status", manifest, "http.request", [
      { url: "https://status.example.com/health" },
    ]);

    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://status.example.com/health",
      expect.objectContaining({ maxRedirections: 0 }),
    );
  });

  it("rejects a request outside the manifest origins before fetching", async () => {
    await expect(
      callExtensionHostService("generated.status", manifest, "http.request", [
        { url: "https://untrusted.example.com/health" },
      ]),
    ).rejects.toThrow("does not have network permission");

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("writes bounded text only when clipboard access is granted", async () => {
    await expect(
      callExtensionHostService(manifest.id, manifest, "clipboard.writeText", ["release-42"]),
    ).rejects.toThrow("does not have clipboard write permission");

    await callExtensionHostService(
      manifest.id,
      { ...manifest, permissions: { clipboardWrite: true } },
      "clipboard.writeText",
      ["release-42"],
    );

    expect(mocks.writeClipboardText).toHaveBeenCalledWith("release-42");

    await expect(
      callExtensionHostService(
        manifest.id,
        { ...manifest, permissions: { clipboardWrite: true } },
        "clipboard.writeText",
        ["x".repeat(100_001)],
      ),
    ).rejects.toThrow("exceeds the 100000 character limit");
    expect(mocks.writeClipboardText).toHaveBeenCalledTimes(1);
  });

  it("shows semantic notifications and rate limits noisy extensions", async () => {
    const notification = {
      title: "Release copied",
      description: "release-42",
      tone: "success",
      duration: 4_000,
    };

    for (let index = 0; index < 5; index += 1) {
      await callExtensionHostService(manifest.id, manifest, "notifications.show", [notification]);
    }

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(5);
    expect(mocks.toastSuccess).toHaveBeenLastCalledWith("Release copied", {
      description: "release-42",
      duration: 4_000,
    });
    await expect(
      callExtensionHostService(manifest.id, manifest, "notifications.show", [notification]),
    ).rejects.toThrow("notification rate limit exceeded");
  });
});
