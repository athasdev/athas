import { describe, expect, it } from "vite-plus/test";
import { filterAgentContext, loadAgentContextPolicy } from "../lib/agent-context-policy";
import type { ProjectRuleReader } from "../types/project-rules.types";

function reader(files: Record<string, string>): ProjectRuleReader {
  return {
    readDirectory: async () =>
      Object.keys(files).map((name) => ({ name, path: `/w/${name}`, isDir: false })),
    readText: async (path) => files[path.slice(3)],
  };
}

describe("AI context exclusions", () => {
  it.each([".athasignore", ".aiignore", ".cursorignore"])(
    "honors %s with directory rules and negation",
    async (name) => {
      const allows = await loadAgentContextPolicy(
        "/w",
        reader({ [name]: "private/\n*.secret\n!public.secret\n" }),
      );
      expect(allows("/w/private", true)).toBe(false);
      expect(allows("/w/private/a.ts")).toBe(false);
      expect(allows("/w/hidden.secret")).toBe(false);
      expect(allows("/w/public.secret")).toBe(true);
      expect(allows("/w/src/app.ts")).toBe(true);
      expect(allows("/work/hidden.secret")).toBe(true);
    },
  );

  it("combines files and prevents negation from exposing credentials", async () => {
    const allows = await loadAgentContextPolicy(
      "/w",
      reader({ ".athasignore": "*.ts", ".cursorignore": "!*.ts\n!.env" }),
    );
    expect(allows("/w/a.ts")).toBe(false);
    expect(allows("/w/.env")).toBe(false);
    expect(allows("/w/.env.local")).toBe(false);
    expect(allows("/w/.git/config")).toBe(false);
    expect(allows("/w/private.pem")).toBe(false);
    expect(allows("/w/src/id_ed25519")).toBe(false);
    expect(allows("/w/src/../private.pem")).toBe(false);
  });

  it("keeps Windows directory boundaries and separators", async () => {
    const io = reader({ ".aiignore": "private/" });
    io.readText = async () => "private/";
    const allows = await loadAgentContextPolicy("C:\\work", io);
    expect(allows("C:\\work\\private\\a.ts")).toBe(false);
    expect(allows("C:\\workspace\\private\\a.ts")).toBe(true);
  });

  it("fails the request when an existing ignore file cannot be read", async () => {
    const io = reader({ ".aiignore": "private/" });
    io.readText = async () => {
      throw new Error("Permission denied");
    };
    await expect(loadAgentContextPolicy("/w", io)).rejects.toThrow("Permission denied");
  });

  it("rejects symlinked ignore files before reading them", async () => {
    let reads = 0;
    const io: ProjectRuleReader = {
      readDirectory: async () => [
        { name: ".aiignore", path: "/w/.aiignore", isDir: false, isSymlink: true },
      ],
      readText: async () => {
        reads++;
        return "private/";
      },
    };
    await expect(loadAgentContextPolicy("/w", io)).rejects.toThrow("must be a text file");
    expect(reads).toBe(0);
  });

  it("filters each context channel without changing unrelated context", async () => {
    const allows = await loadAgentContextPolicy("/w", reader({ ".aiignore": "private/" }));
    const allowed = { id: "public", path: "/w/a.ts" } as never;
    const excluded = { id: "private", path: "/w/private/a.ts" } as never;
    const filtered = filterAgentContext(
      {
        projectRoot: "/w",
        activeBuffer: excluded,
        openBuffers: [excluded, allowed],
        selectedProjectFiles: ["/w/private/a.ts", "/w/a.ts"],
        mentionedFiles: [{ name: "a.ts", path: "/w/private/a.ts", content: "private" }],
        editorSelections: [{ filePath: "/w/private/a.ts", selectedText: "private" } as never],
        images: [{ mediaType: "image/png", data: "abc" }],
      },
      allows,
    );
    expect(filtered.activeBuffer).toBeUndefined();
    expect(filtered.openBuffers).toEqual([allowed]);
    expect(filtered.selectedProjectFiles).toEqual(["/w/a.ts"]);
    expect(filtered.mentionedFiles).toEqual([]);
    expect(filtered.editorSelections).toEqual([]);
    expect(filtered.images).toHaveLength(1);
  });
});
