import { describe, expect, it, vi } from "vite-plus/test";
import type { WorkspaceResourceProvider } from "../services/workspace-resource-provider";
import {
  createFileOpenResource,
  inspectFileOpenResource,
  readFileOpenText,
} from "../services/file-open-resource";

const createProvider = (
  kind: WorkspaceResourceProvider["kind"],
  overrides: Partial<WorkspaceResourceProvider> = {},
): WorkspaceResourceProvider => ({
  kind,
  readDirectory: vi.fn().mockResolvedValue([]),
  readText: vi.fn().mockResolvedValue("text"),
  readBytes: vi.fn().mockResolvedValue(null),
  ...overrides,
});

describe("file open resources", () => {
  it("keeps remote paths on the remote provider without byte inspection", () => {
    const provider = createProvider("remote");
    const resolveProvider = vi.fn(() => provider);
    const path = "remote://connection/repo/file.unknown";

    const resource = createFileOpenResource(path, "/resolved/file.unknown", resolveProvider);

    expect(resource).toMatchObject({
      provider,
      providerPath: path,
      shouldInspectBytes: false,
    });
    expect(resolveProvider).toHaveBeenCalledWith(path);
  });

  it("preloads unknown local text from the byte inspection", async () => {
    const readBytes = vi.fn().mockResolvedValue(new TextEncoder().encode("hello"));
    const readText = vi.fn().mockResolvedValue("fallback");
    const provider = createProvider("local", { readBytes, readText });
    const resource = createFileOpenResource(
      "/workspace/file.unknown",
      "/workspace/file.unknown",
      () => provider,
    );

    const inspection = await inspectFileOpenResource(resource);

    expect(inspection).toEqual({ isBinary: false, preloadedText: "hello" });
    await expect(readFileOpenText(resource, inspection.preloadedText)).resolves.toBe("hello");
    expect(readBytes).toHaveBeenCalledOnce();
    expect(readText).not.toHaveBeenCalled();
  });

  it("classifies null-byte content as binary", async () => {
    const provider = createProvider("local", {
      readBytes: vi.fn().mockResolvedValue(Uint8Array.from([104, 0, 105])),
    });
    const resource = createFileOpenResource(
      "/workspace/file.unknown",
      "/workspace/file.unknown",
      () => provider,
    );

    await expect(inspectFileOpenResource(resource)).resolves.toEqual({
      isBinary: true,
      preloadedText: null,
    });
  });

  it("deduplicates concurrent provider text reads", async () => {
    let resolveRead: ((value: string) => void) | undefined;
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const provider = createProvider("local", { readText });
    const resource = createFileOpenResource(
      "/workspace/file.txt",
      "/workspace/file.txt",
      () => provider,
    );

    const firstRead = readFileOpenText(resource, null);
    const secondRead = readFileOpenText(resource, null);
    resolveRead?.("shared");

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual(["shared", "shared"]);
    expect(readText).toHaveBeenCalledOnce();
  });

  it("allows a retry after a provider read rejects", async () => {
    const readText = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("recovered");
    const provider = createProvider("local", { readText });
    const resource = createFileOpenResource(
      "/workspace/retry.txt",
      "/workspace/retry.txt",
      () => provider,
    );

    await expect(readFileOpenText(resource, null)).rejects.toThrow("temporary");
    await expect(readFileOpenText(resource, null)).resolves.toBe("recovered");
    expect(readText).toHaveBeenCalledTimes(2);
  });
});
