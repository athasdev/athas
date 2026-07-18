import { describe, expect, it } from "vite-plus/test";
import {
  isExternalMarkdownLink,
  resolveWorkspaceFileLink,
} from "@/features/ai/lib/workspace-file-links";
import type { FileEntry } from "@/features/file-system/types/app.types";

const rootFolderPath = "/workspace";
const files: FileEntry[] = [
  {
    name: "code-block.tsx",
    path: "/workspace/packages/web/app/features/chat/components/code-block.tsx",
    isDir: false,
  },
  {
    name: "button.tsx",
    path: "/workspace/src/ui/button.tsx",
    isDir: false,
  },
];

describe("workspace file links", () => {
  it("resolves a bare filename to a workspace file", () => {
    expect(
      resolveWorkspaceFileLink("code-block.tsx", "code-block.tsx", files, rootFolderPath),
    ).toEqual({
      path: "/workspace/packages/web/app/features/chat/components/code-block.tsx",
    });
  });

  it("resolves relative file paths", () => {
    expect(
      resolveWorkspaceFileLink("src/ui/button.tsx", "button.tsx", files, rootFolderPath),
    ).toEqual({
      path: "/workspace/src/ui/button.tsx",
    });
  });

  it("preserves line and column suffixes", () => {
    expect(
      resolveWorkspaceFileLink("src/ui/button.tsx:42:3", "button.tsx", files, rootFolderPath),
    ).toEqual({
      path: "/workspace/src/ui/button.tsx",
      line: 42,
      column: 3,
    });
  });

  it("preserves hash line suffixes", () => {
    expect(
      resolveWorkspaceFileLink("src/ui/button.tsx#L42", "button.tsx", files, rootFolderPath),
    ).toEqual({
      path: "/workspace/src/ui/button.tsx",
      line: 42,
    });
  });

  it("keeps external URLs out of workspace resolution", () => {
    expect(isExternalMarkdownLink("https://example.com/code-block.tsx")).toBe(true);
    expect(
      resolveWorkspaceFileLink(
        "https://example.com/code-block.tsx",
        "code-block.tsx",
        files,
        rootFolderPath,
      ),
    ).toBeNull();
  });
});
