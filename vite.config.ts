import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { defaultExclude, defineConfig } from "vite-plus";
import { createReactCompilerPreset } from "./scripts/vite/react-compiler";

const host = process.env.TAURI_DEV_HOST || "127.0.0.1";
const isVitest = Boolean(process.env.VITEST);
const enableReactCompiler = !isVitest && process.env.ATHAS_REACT_COMPILER !== "0";
const enableCodeInspector = process.env.VITE_CODE_INSPECTOR === "true";
const webviewTargets = ["chrome96", "edge96", "firefox94", "safari15"];

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    "import.meta.env.VITE_REACT_COMPILER_ENABLED": JSON.stringify(enableReactCompiler),
  },
  fmt: {
    printWidth: 100,
  },
  lint: {
    jsPlugins: ["@shadcn/lint"],
    settings: {
      shadcn: {
        // Icons and brand marks take color from context.
        ignoreImports: ["^@/ui/icons(/|$)", "^@/ui/brand-marks(/|$)"],
        note: "See the UI Design System section of AGENTS.md.",
      },
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "typescript/await-thenable": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-misused-spread": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-useless-empty-export": "off",
      "typescript/no-useless-default-assignment": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "shadcn/no-raw-colors": "error",
      "shadcn/no-unknown-classes": [
        "error",
        {
          // Plain selectors that CSS or DOM queries rely on.
          allow: [
            "editor-container",
            "file-tree-container",
            "github-markdown-*",
            "inline-edit-model-command",
            "items-container",
            "pdf-page-container",
            "terminal-container",
            "xterm-container",
          ],
        },
      ],
      "shadcn/no-arbitrary-values": [
        "error",
        // Layout sizes, transition property lists and inherited radii are structural.
        { allow: ["layout", "transition", "rounded-[inherit]", "rounded-b-[inherit]"] },
      ],
      "shadcn/no-restyle": [
        "error",
        {
          // Only overlay sizing is enforced so far; bun check:design reports the wider policy.
          deny: [],
          contracts: [
            {
              pattern:
                "^(DropdownMenuContent|DropdownMenuSubContent|PopoverContent|PopoverListContent|SelectContent|ComboboxContent)$",
              deny: ["w-*", "min-w-*", "max-w-*"],
              message:
                "<{{component}}> takes its width from the size preset in src/ui/overlay-size.ts, not {{className}}.",
            },
            {
              pattern: "^(DropdownMenuContent|DropdownMenuSubContent)$",
              deny: ["w-*", "min-w-*", "max-w-*", "max-h-*"],
              message:
                "<{{component}}> takes its width from the size preset and its scroll cap from the viewport variant, not {{className}}.",
            },
          ],
        },
      ],
    },
    overrides: [
      {
        // Primitives compose each other and own their exact sizes.
        files: ["src/ui/**"],
        rules: { "shadcn/no-restyle": "off" },
      },
    ],
  },
  staged: {
    "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": "vp check --fix",
    "*.{css,html,json,jsonc,md,mdx,toml,yaml,yml}": "vp fmt --write",
  },
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
    enableReactCompiler ? babel({ presets: [createReactCompilerPreset()] }) : null,
    tailwindcss(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    testTimeout: 10_000,
    // The runner's default exclude only covers node_modules/.git, so it would
    // otherwise discover stale duplicate suites inside generated or vendored
    // trees — notably the direnv-materialized copy of the source under
    // .direnv/flake-inputs/<hash>-source/.
    exclude: [
      ...defaultExclude,
      "**/.direnv/**",
      "**/.delta/**",
      "**/dist/**",
      "**/build/**",
      "**/target/**",
      "**/src-tauri/**",
    ],
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
