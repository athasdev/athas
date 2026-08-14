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

  it("can delegate sticky positioning to a virtualized owner", () => {
    const markup = renderToStaticMarkup(
      <MultibufferFileHeader
        filePath="src/file.ts"
        fileName="file.ts"
        onOpen={vi.fn()}
        sticky={false}
      />,
    );

    expect(markup).not.toContain("sticky top-0");
  });
});
