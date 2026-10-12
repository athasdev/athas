import path from "node:path";
import { defineConfig, mergeConfig, type Plugin } from "vite-plus";
import baseConfig from "./vite.config";

// The origins allowed to embed the web editor in a frame. The athas.dev dashboard embeds it;
// WEB_EDITOR_FRAME_ANCESTORS (space separated) replaces the list, e.g. to add a preview host.
const frameAncestors = process.env.WEB_EDITOR_FRAME_ANCESTORS?.trim() || "https://athas.dev";

const securityHeaders = [
  `Content-Security-Policy: frame-ancestors ${frameAncestors}`,
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "Permissions-Policy: camera=(), microphone=(), geolocation=()",
];

/** Serves the page as index.html and writes the Cloudflare `_headers` file next to it. */
function webEditorOutput(): Plugin {
  return {
    name: "athas-web-editor-output",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = bundle["web.html"];
      if (page) page.fileName = "index.html";
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*\n${securityHeaders.map((header) => `  ${header}`).join("\n")}\n`,
      });
    },
  };
}

// Builds the real workbench as a static site with the Tauri backend replaced by an in-memory one
// (src/features/web-workbench). It is deployed on its own to editor.athas.dev and never part of
// the desktop bundle, whose build only starts from index.html.
export default mergeConfig(
  baseConfig,
  defineConfig({
    // The editor accepts cloud workspace sessions only from the pages allowed to embed it.
    define: {
      "import.meta.env.VITE_WEB_EDITOR_PARENT_ORIGINS": JSON.stringify(frameAncestors),
    },
    server: { hmr: false },
    build: {
      outDir: "dist-web",
      emptyOutDir: true,
      rolldownOptions: {
        input: { index: path.resolve(__dirname, "web.html") },
      },
    },
    plugins: [webEditorOutput()],
  }),
);
