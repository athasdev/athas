import { describe, expect, it, vi } from "vite-plus/test";
import { readLocalHistoryEntry } from "../api/local-history-api";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("local history text decoding", () => {
  it.each(["const value = 1;\r\n", "\uFEFFconst value = 1;\r\n"])(
    "normalizes snapshot encoding markers (%s)",
    async (raw) => {
      invoke.mockResolvedValueOnce(raw);
      await expect(readLocalHistoryEntry("/workspace/file.ts", "entry")).resolves.toBe(
        "const value = 1;\r\n",
      );
    },
  );
});
