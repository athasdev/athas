import { describe, expect, it, vi } from "vite-plus/test";
import { executeFileExplorerMove } from "../hooks/use-file-explorer-drag-drop";

describe("file explorer move", () => {
  it("awaits the owning move handler", async () => {
    let finishMove: (() => void) | undefined;
    const onFileMove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishMove = resolve;
        }),
    );

    const move = executeFileExplorerMove("/workspace/a.ts", "/workspace/src/a.ts", onFileMove);

    expect(onFileMove).toHaveBeenCalledWith("/workspace/a.ts", "/workspace/src/a.ts");
    let completed = false;
    void move.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    finishMove?.();
    await expect(move).resolves.toBeUndefined();
  });

  it("reports a missing move owner instead of mutating outside the store", async () => {
    await expect(executeFileExplorerMove("/workspace/a.ts", "/workspace/src/a.ts")).rejects.toThrow(
      "File move handler is unavailable",
    );
  });

  it("preserves move failures for the drag-drop error surface", async () => {
    const error = new Error("move failed");

    await expect(
      executeFileExplorerMove("/workspace/a.ts", "/workspace/src/a.ts", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
