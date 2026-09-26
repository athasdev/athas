import { describe, expect, it } from "vite-plus/test";
import { getAcpMimeType } from "@/features/ai/lib/acp-mime-type";
import { buildAcpPrompt } from "@/features/ai/lib/acp-prompt";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";

const selection = {
  id: "sel-1",
  bufferId: "buf-1",
  filePath: "/work/src/app.ts",
  fileName: "app.ts",
  languageId: "typescript",
  selectedText: "const answer = 42;",
  startLine: 10,
  startColumn: 1,
  endLine: 12,
  endColumn: 5,
};

const context: ContextInfo = {
  projectRoot: "/work",
  agentId: "claude-code",
  selectedProjectFiles: ["/work/logo.png", "/work/Makefile", "/work/notes.md"],
  editorSelections: [selection],
};

describe("getAcpMimeType", () => {
  it("names common types by extension and leaves unknown ones out", () => {
    expect(getAcpMimeType("/a/logo.PNG")).toBe("image/png");
    expect(getAcpMimeType("/a/report.pdf")).toBe("application/pdf");
    expect(getAcpMimeType("/a/main.rs")).toBe("text/x-rust");
    expect(getAcpMimeType("/a/Makefile")).toBeUndefined();
    expect(getAcpMimeType("/a/.env")).toBeUndefined();
    expect(getAcpMimeType("/a/data.unknownext")).toBeUndefined();
    expect(getAcpMimeType("/a.dir/file")).toBeUndefined();
  });
});

describe("buildAcpPrompt", () => {
  it("links files with their real type and pastes selections without embedded context", () => {
    const [text, ...rest] = buildAcpPrompt("Fix it", context, { embeddedContext: false });

    expect(text.type === "text" && text.text).toContain("```typescript\nconst answer = 42;");
    expect(rest).toEqual([
      {
        type: "resource_link",
        uri: "file:///work/logo.png",
        name: "logo.png",
        mimeType: "image/png",
      },
      { type: "resource_link", uri: "file:///work/Makefile", name: "Makefile" },
      {
        type: "resource_link",
        uri: "file:///work/notes.md",
        name: "notes.md",
        mimeType: "text/markdown",
      },
    ]);
  });

  it("embeds editor selections as resources when the agent takes them", () => {
    const [text, ...rest] = buildAcpPrompt("Fix it", context, { embeddedContext: true });

    expect(text.type === "text" && text.text).toContain(
      "Selected editor context (attached):\n- src/app.ts:10-12",
    );
    expect(text.type === "text" && text.text).not.toContain("const answer = 42;");
    expect(rest[0]).toEqual({
      type: "resource",
      resource: {
        uri: "file:///work/src/app.ts#L10:12",
        text: "const answer = 42;",
        mimeType: "text/x-typescript",
      },
    });
  });

  it("keeps a slash command first and sends no context", () => {
    expect(buildAcpPrompt("/review", context, { embeddedContext: true })).toEqual([
      { type: "text", text: "/review" },
    ]);
  });
});
