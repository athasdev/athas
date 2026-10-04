import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({
  read: vi.fn(async (path: string) => `Content of ${path}`),
  provider: vi.fn(),
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: mocks.provider,
}));
import {
  formatMentionToken,
  loadFilesByPaths,
  parseMentionsAndLoadFiles,
} from "../lib/file-mentions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider.mockReturnValue({ readText: mocks.read });
});
describe("file attachment loading", () => {
  it("filters excluded mentions before reading their contents", async () => {
    const message = `${formatMentionToken("private.ts", "/w/private.ts")} ${formatMentionToken("public.ts", "/w/public.ts")}`;
    const result = await parseMentionsAndLoadFiles(message, [], (path) => path !== "/w/private.ts");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("/w/public.ts");
    expect(result.mentionedFiles.map((file) => file.path)).toEqual(["/w/public.ts"]);
    expect(result.processedMessage).not.toContain("Content of /w/private.ts");
  });
  it.each(["remote://server/home/me/app.ts", "wsl://Ubuntu/home/me/app.ts", "/w/app.ts"])(
    "reads %s through its workspace provider",
    async (path) => {
      const [file] = await loadFilesByPaths([path]);
      expect(mocks.provider).toHaveBeenCalledWith(path);
      expect(mocks.read).toHaveBeenCalledWith(path);
      expect(file.content).toBe(`Content of ${path}`);
    },
  );
});
