import { describe, expect, it } from "vite-plus/test";
import { createPaneContent } from "../stores/buffer-content-factory";

describe("Markdown document buffers", () => {
  it("creates a unique virtual rich-text document", () => {
    const document = createPaneContent("document", {
      type: "markdownDocument",
      documentId: "test-document",
      content: "# Draft",
    });

    expect(document).toMatchObject({
      type: "markdownDocument",
      path: "markdown-document://test-document",
      name: "Untitled Document",
      content: "# Draft",
      isPreview: false,
    });
  });
});
