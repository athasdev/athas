import { describe, expect, it } from "vite-plus/test";
import { buildHtmlPreviewDocument } from "./html-preview-document";

const toAssetUrl = (path: string) => `asset://${path}`;

describe("buildHtmlPreviewDocument", () => {
  it("injects a base URL for relative assets", () => {
    const html = '<html><head></head><body><img src="logo.png"></body></html>';

    expect(
      buildHtmlPreviewDocument(html, {
        sourcePath: "/workspace/site/index.html",
        rootFolderPath: "/workspace/site",
        convertFilePathToUrl: toAssetUrl,
      }),
    ).toContain('<base href="asset:///workspace/site/">');
  });

  it("rewrites root-relative assets to the workspace root", () => {
    const html =
      '<html><head><script type="module" src="/src/main.tsx"></script></head><body></body></html>';

    const result = buildHtmlPreviewDocument(html, {
      sourcePath: "/workspace/site/index.html",
      rootFolderPath: "/workspace/site",
      convertFilePathToUrl: toAssetUrl,
    });

    expect(result).toContain('src="asset:///workspace/site/src/main.tsx"');
  });

  it("rewrites root-relative inline module imports to the workspace root", () => {
    const html = `<script type="module">
      import { bootstrap } from "/src/bootstrap.ts";
      import("/src/lazy.ts");
      export { bootstrap as start } from "/src/bootstrap.ts";
    </script>`;

    const result = buildHtmlPreviewDocument(html, {
      sourcePath: "/workspace/site/index.html",
      rootFolderPath: "/workspace/site",
      convertFilePathToUrl: toAssetUrl,
    });

    expect(result).toContain('from "asset:///workspace/site/src/bootstrap.ts"');
    expect(result).toContain('import("asset:///workspace/site/src/lazy.ts"');
    expect(result).toContain('from "asset:///workspace/site/src/bootstrap.ts"');
  });

  it("preserves query and hash suffixes on rewritten asset URLs", () => {
    const html = '<link href="/assets/app.css?v=1#theme" rel="stylesheet">';

    const result = buildHtmlPreviewDocument(html, {
      sourcePath: "/workspace/site/pages/index.html",
      rootFolderPath: "/workspace/site",
      convertFilePathToUrl: toAssetUrl,
    });

    expect(result).toContain('href="asset:///workspace/site/assets/app.css?v=1#theme"');
  });

  it("does not rewrite external or protocol-relative URLs", () => {
    const html =
      '<img src="https://example.com/a.png"><script src="//cdn.example.com/lib.js"></script>';

    const result = buildHtmlPreviewDocument(html, {
      sourcePath: "/workspace/site/index.html",
      rootFolderPath: "/workspace/site",
      convertFilePathToUrl: toAssetUrl,
    });

    expect(result).toContain('src="https://example.com/a.png"');
    expect(result).toContain('src="//cdn.example.com/lib.js"');
  });

  it("rewrites root-relative srcset candidates", () => {
    const html = '<img srcset="/small.png 1x, /large.png 2x, local.png 3x">';

    const result = buildHtmlPreviewDocument(html, {
      sourcePath: "/workspace/site/index.html",
      rootFolderPath: "/workspace/site",
      convertFilePathToUrl: toAssetUrl,
    });

    expect(result).toContain(
      'srcset="asset:///workspace/site/small.png 1x, asset:///workspace/site/large.png 2x, local.png 3x"',
    );
  });
});
