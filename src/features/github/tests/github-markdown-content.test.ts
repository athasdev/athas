import { describe, expect, it, vi } from "vite-plus/test";
import { parseMarkdown } from "@/features/editor/markdown/parser";
import { normalizeGitHubMarkdown } from "../utils/github-markdown-content";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
  },
}));

describe("normalizeGitHubMarkdown", () => {
  const repositoryUrl = "https://github.com/athasdev/athas";

  it("renders standalone GitHub attachments as inline video", () => {
    const attachmentUrl =
      "https://github.com/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef";

    const normalized = normalizeGitHubMarkdown(`Before\n\n${attachmentUrl}`, repositoryUrl);

    expect(normalized).toContain(
      `<video class="github-markdown-attachment" src="${attachmentUrl}" controls preload="metadata" playsinline>`,
    );
    expect(parseMarkdown(normalized)).toContain(
      `<video class="github-markdown-attachment" src="${attachmentUrl}" controls preload="metadata" playsinline>`,
    );
  });

  it("preserves uploaded images already expressed as Markdown", () => {
    const image =
      "![Before](https://github.com/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef)";

    expect(normalizeGitHubMarkdown(image, repositoryUrl)).toBe(image);
  });

  it("links issue references without rewriting code or existing links", () => {
    const content = [
      "Fixes #714 and keeps `#715` literal.",
      "[Existing #716](https://github.com/athasdev/athas/issues/716)",
      "```text",
      "#717",
      "```",
    ].join("\n");

    const normalized = normalizeGitHubMarkdown(content, repositoryUrl);

    expect(normalized).toContain(
      "Fixes [#714](https://github.com/athasdev/athas/issues/714) and keeps `#715` literal.",
    );
    expect(normalized).toContain("[Existing #716](https://github.com/athasdev/athas/issues/716)");
    expect(normalized).toContain("```text\n#717\n```");
  });

  it("links cross-repository references to the referenced repository", () => {
    expect(normalizeGitHubMarkdown("See athasdev/www#42", repositoryUrl)).toBe(
      "See [athasdev/www#42](https://github.com/athasdev/www/issues/42)",
    );
  });

  it("leaves malformed attachment paths as ordinary text", () => {
    const nestedAttachment = "https://github.com/user-attachments/assets/01234567/preview";

    expect(normalizeGitHubMarkdown(nestedAttachment, repositoryUrl)).toBe(nestedAttachment);
  });
});
