import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { defineConfig } from "vite-plus";

const host = process.env.TAURI_DEV_HOST || "127.0.0.1";
const isVitest = Boolean(process.env.VITEST);
const enableCodeInspector = process.env.VITE_CODE_INSPECTOR === "true";
const webviewTargets = ["chrome96", "edge96", "firefox94", "safari15"];

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    // Tauri uses the system WKWebView on macOS. macOS 12 can run an older
    // Safari 15-era WebKit, so do not inherit Vite's moving Baseline target.
    target: webviewTargets,
    cssTarget: webviewTargets,
  },
  worker: {
    rolldownOptions: {
      transform: {
        target: webviewTargets,
      },
    },
  },
  plugins: [
    !isVitest && enableCodeInspector
      ? codeInspectorPlugin({
          bundler: "vite",
        })
      : null,
    react(),
    tailwindcss(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore app-owned files that should not reload the
      // editor while they are being edited from inside the editor itself.
      ignored: ["**/src-tauri/**", "**/interceptor/**", "**/index.html"],
    },
  },
});
