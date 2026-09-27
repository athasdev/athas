import { describe, expect, it } from "vite-plus/test";
import type { FileEntry } from "@/features/file-system/types/app.types";
import {
  appendReferencedFiles,
  extractFileMentionNames,
  formatMentionToken,
  parseMentionTokens,
  resolveMentionPaths,
} from "../lib/file-mentions";

const file = (path: string): FileEntry => ({
  name: path.split("/").pop() ?? path,
  path,
  isDir: false,
});

describe("file mentions", () => {
  it("extracts multiple composer tokens without merging adjacent context", () => {
    expect(extractFileMentionNames("@[01-bug.yml] @[03-enhancement.yml] follow up")).toEqual([
      "01-bug.yml",
      "03-enhancement.yml",
    ]);
  });

  it("supports file names with spaces and ignores bare @ words", () => {
    expect(
      extractFileMentionNames(
        "@[release notes.md] @README.md needs @types/node, @Component() and me@example.com",
      ),
    ).toEqual(["release notes.md"]);
  });

  it("round-trips chips whose names and paths contain brackets, parentheses and spaces", () => {
    const path = "/w/app/(marketing)/[slug]/my page%.tsx";
    const message = `See ${formatMentionToken("[slug] page.tsx", path)} now`;

    expect(parseMentionTokens(message)).toEqual([
      {
        start: 4,
        end: message.length - 4,
        name: "[slug] page.tsx",
        path,
      },
    ]);
  });

  it("resolves chips by their exact path even when names repeat", () => {
    const files = [file("/w/src/a/index.ts"), file("/w/src/b/index.ts")];
    const message = `${formatMentionToken("index.ts", "/w/src/b/index.ts")} explain`;

    expect(resolveMentionPaths(message, files)).toEqual(["/w/src/b/index.ts"]);
  });

  it("resolves saved name-only chips only when the name is unambiguous", () => {
    const files = [file("/w/src/a/index.ts"), file("/w/src/b/index.ts"), file("/w/README.md")];

    expect(resolveMentionPaths("@[README.md] @[index.ts] @[b/index.ts]", files)).toEqual([
      "/w/README.md",
      "/w/src/b/index.ts",
    ]);
  });

  it("appends selected file contents to provider messages", () => {
    expect(
      appendReferencedFiles("Review this", [
        {
          name: "app.ts",
          path: "/workspace/app.ts",
          content: "export const ready = true;",
        },
      ]),
    ).toContain("### app.ts (/workspace/app.ts)\n```\nexport const ready = true;\n```");
  });
});
