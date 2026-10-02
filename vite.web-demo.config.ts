import path from "node:path";
import { defineConfig, mergeConfig } from "vite-plus";
import baseConfig from "./vite.config";

// Builds the real workbench as a static site with the Tauri backend replaced by an in-memory
// demo (src/features/web-demo). athas.dev embeds the output in its landing page hero.
export default mergeConfig(
  baseConfig,
  defineConfig({
    base: "./",
    server: { hmr: false },
    build: {
      outDir: "dist-web-demo",
      emptyOutDir: true,
      rolldownOptions: {
        input: { index: path.resolve(__dirname, "web-demo.html") },
      },
    },
  }),
);
