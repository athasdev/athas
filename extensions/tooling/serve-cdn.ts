import { extname, join, normalize } from "node:path";
import { GENERATED_CDN_DIR } from "./extension-workspace";

const port = Number(process.env.EXTENSIONS_CDN_PORT || 14321);
const contentTypes: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

Bun.serve({
  port,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const relativePath = normalize(pathname || "index.json");
    if (relativePath.startsWith("..") || relativePath.includes("/../")) {
      return new Response("Invalid path", { status: 400 });
    }

    const file = Bun.file(join(GENERATED_CDN_DIR, relativePath));
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(file, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[extname(relativePath)] || "application/octet-stream",
      },
    });
  },
});

console.log(`Extension CDN available at http://localhost:${port}`);
