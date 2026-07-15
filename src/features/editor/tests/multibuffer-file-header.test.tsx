import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { MultibufferFileHeader } from "../components/multibuffer/multibuffer-file-header";

describe("MultibufferFileHeader", () => {
  it("sets an explicit readable text color on the file action", () => {
    const markup = renderToStaticMarkup(
      <MultibufferFileHeader
        filePath="src/file.ts"
        fileName="file.ts"
        directoryPath="src/"
        onOpen={vi.fn()}
      />,
    );

    expect(markup).toMatch(/<button[^>]*class="[^"]*text-text/);
    expect(markup).toContain("file.ts");
  });
});
