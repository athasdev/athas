import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { MultibufferFileHeader } from "../components/multibuffer/multibuffer-file-header";

describe("MultibufferFileHeader", () => {
  it("uses UI typography for file header chrome", () => {
    const markup = renderToStaticMarkup(
      <MultibufferFileHeader
        filePath="src/file.ts"
        fileName="file.ts"
        directoryPath="src/"
        onOpen={vi.fn()}
      />,
    );

    expect(markup).toMatch(/<button[^>]*class="[^"]*text-foreground/);
    expect(markup).toContain("font-sans");
    expect(markup).not.toContain("font-mono");
    expect(markup).not.toContain("font-family");
    expect(markup).toContain("file.ts");
    expect(markup).toContain("sticky top-0");
  });

  it("renders a collapse control only when the owner can toggle the section", () => {
    const collapsible = renderToStaticMarkup(
      <MultibufferFileHeader
        filePath="src/file.ts"
        fileName="file.ts"
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        expanded={false}
      />,
    );
    const plain = renderToStaticMarkup(
      <MultibufferFileHeader filePath="src/file.ts" fileName="file.ts" onOpen={vi.fn()} />,
    );

    expect(collapsible).toContain('aria-expanded="false"');
    expect(plain).not.toContain("aria-expanded");
  });
});
