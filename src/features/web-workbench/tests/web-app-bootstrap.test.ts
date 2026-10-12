import { describe, expect, it, vi } from "vite-plus/test";
import { isWorkbenchFetchAllowed } from "@/features/web-workbench/bootstrap/install-web-backend";
import {
  createSwitchableBackend,
  createWorkspaceSwitcher,
} from "@/features/web-workbench/bootstrap/remote-workspace";
import { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";
import { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { createWebBackend } from "@/features/web-workbench/services/web-backend";
import type { WorkspaceConnection } from "@/features/web-workbench/services/workspace-connection";

const SAMPLE_ROOT = "/sample/site";
const ROOT = "/workspace/athas";

describe("web app fetch", () => {
  const origin = "https://athas.dev";
  const allowed = (url: string) => isWorkbenchFetchAllowed(new URL(url, origin), origin, "/app/");

  it("lets the workbench load its own assets and inline data only", () => {
    expect(allowed("/app/assets/icon.svg")).toBe(true);
    expect(allowed("data:text/plain,hi")).toBe(true);
    expect(allowed("/api/auth/me")).toBe(false);
    expect(allowed("/dashboard")).toBe(false);
    expect(allowed("https://api.github.com/user")).toBe(false);
    expect(allowed("https://evil.example/app/x")).toBe(false);
  });
});

describe("workspace switcher", () => {
  function setup() {
    const fs = new MemoryFileSystem(SAMPLE_ROOT, { "README.md": "# Sample" }, ["/sample"]);
    const sample = createWebBackend({
      home: "/sample",
      fs,
      git: new MemoryGitRepository(fs, SAMPLE_ROOT, { branch: "main", head: {} }),
      appVersion: "1.0.0",
    });
    const backend = createSwitchableBackend(sample);
    const call = vi.fn(async (method: string) =>
      method === "fs.exists" ? { exists: true } : ({} as never),
    );
    const connection = {
      call,
      onEvent: () => () => {},
      onTerminalOutput: () => () => {},
    } as unknown as WorkspaceConnection;
    const openFolder = vi.fn(async () => true);
    const closeFolder = vi.fn(async () => true);
    const switcher = createWorkspaceSwitcher({
      backend,
      sample,
      sampleRoot: SAMPLE_ROOT,
      openFolder,
      closeFolder,
      emit: vi.fn(),
    });
    return { backend, switcher, connection, call, openFolder, closeFolder };
  }

  it("routes the repository to the workspace and keeps the sample beside it", async () => {
    const { backend, switcher, connection, call, openFolder } = setup();
    expect(await backend.handle("plugin:fs|exists", { path: `${ROOT}/README.md` })).toBe(false);

    await switcher.activate(connection, {
      id: "w",
      repo: "athasdev/athas",
      branch: "main",
      root: ROOT,
      terminals: [],
      stopsAt: 0,
    });

    expect(openFolder).toHaveBeenLastCalledWith(ROOT);
    expect(await backend.handle("plugin:fs|exists", { path: `${ROOT}/README.md` })).toBe(true);
    expect(call).toHaveBeenCalledWith("fs.exists", { path: "README.md" });
    expect(await backend.handle("plugin:fs|exists", { path: `${SAMPLE_ROOT}/README.md` })).toBe(
      true,
    );
  });

  it("closes the repository and goes back to the sample when the workspace ends", async () => {
    const { backend, switcher, connection, call, openFolder, closeFolder } = setup();
    await switcher.activate(connection, {
      id: "w",
      repo: "athasdev/athas",
      branch: "main",
      root: ROOT,
      terminals: [],
      stopsAt: 0,
    });

    await switcher.deactivate();

    expect(closeFolder).toHaveBeenCalledWith(ROOT);
    expect(openFolder).toHaveBeenLastCalledWith(SAMPLE_ROOT);
    call.mockClear();
    expect(await backend.handle("plugin:fs|exists", { path: `${ROOT}/README.md` })).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});
