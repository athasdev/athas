import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { defineConfig, mergeConfig, type Plugin } from "vite-plus";
import baseConfig from "./vite.config";

// Athas in the browser, served on the athas.dev website's origin at /app (see web/wrangler.jsonc).
// The build writes the static site to dist-web: the app under dist-web/app and the Cloudflare
// `_headers` file beside it.
const BASE = "/app/";
const siteDir = path.resolve(__dirname, "dist-web");
const appDir = path.join(siteDir, "app");

// The website the dev server sends everything outside /app to, so the app reaches its /api with
// the same cookie as in production. Run www with `bun dev` first.
const websiteUrl = process.env.ATHAS_WEBSITE_URL?.trim() || "http://localhost:3000";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Cloud workspaces are reached over a socket to the athas-cloud Worker.
  "connect-src 'self' https://realtime.athas.dev wss://realtime.athas.dev",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  `Content-Security-Policy: ${contentSecurityPolicy}`,
  "X-Frame-Options: DENY",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "Permissions-Policy: camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
];

/** The Cloudflare `_headers` file: security headers for the app, long caching for hashed files. */
function renderHeadersFile() {
  const block = (pattern: string, headers: string[]) =>
    `${pattern}\n${headers.map((header) => `  ${header}`).join("\n")}\n`;
  return [
    block("/app", securityHeaders),
    block("/app/*", securityHeaders),
    block("/app/assets/*", ["Cache-Control: public, max-age=31536000, immutable"]),
  ].join("");
}

function isAppPage(request: IncomingMessage) {
  const url = request.url ?? "";
  if (!/^\/app(\/|\?|$)/.test(url)) return false;
  const pathname = url.split("?")[0] ?? "";
  return !path.extname(pathname) && Boolean(request.headers.accept?.includes("text/html"));
}

function webAppOutput(): Plugin {
  return {
    name: "athas-web-app-output",
    enforce: "post",
    configureServer(server) {
      // Every page under /app is the web app, as on athas.dev.
      server.middlewares.use((request, _response, next) => {
        if (isAppPage(request)) request.url = `${BASE}web.html`;
        next();
      });
    },
    buildStart() {
      if (this.meta.watchMode) return;
      fs.rmSync(siteDir, { recursive: true, force: true });
    },
    generateBundle(_options, bundle) {
      const page = bundle["web.html"];
      if (page) page.fileName = "index.html";
    },
    writeBundle() {
      fs.writeFileSync(path.join(siteDir, "_headers"), renderHeadersFile());
    },
  };
}

// Builds the real workbench as a static site with the Tauri backend replaced by an in-memory one
// (src/features/web-workbench). It is never part of the desktop bundle, whose build only starts
// from index.html.
export default mergeConfig(
  baseConfig,
  defineConfig({
    base: BASE,
    define: {
      "import.meta.env.VITE_ATHAS_WEB": JSON.stringify("true"),
    },
    server: {
      host: "localhost",
      port: 1430,
      hmr: false,
      proxy: {
        "^/(?!app(?:/|\\?|$))": { target: websiteUrl, changeOrigin: true, ws: true },
      },
    },
    build: {
      outDir: appDir,
      emptyOutDir: true,
      rolldownOptions: {
        input: { index: path.resolve(__dirname, "web.html") },
      },
    },
    plugins: [webAppOutput()],
  }),
);
