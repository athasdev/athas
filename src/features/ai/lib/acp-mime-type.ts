import { getAcpPathBaseName } from "@/features/ai/lib/acp-file-uri";
import { getImageMimeType } from "@/utils/image-file-types";

const MIME_TYPES: Record<string, string> = {
  c: "text/x-c",
  cc: "text/x-c++",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  css: "text/css",
  csv: "text/csv",
  go: "text/x-go",
  h: "text/x-c",
  hpp: "text/x-c++",
  htm: "text/html",
  html: "text/html",
  java: "text/x-java",
  js: "text/javascript",
  json: "application/json",
  jsx: "text/javascript",
  kt: "text/x-kotlin",
  md: "text/markdown",
  mdx: "text/markdown",
  mjs: "text/javascript",
  cjs: "text/javascript",
  php: "text/x-php",
  py: "text/x-python",
  rb: "text/x-ruby",
  rs: "text/x-rust",
  scss: "text/x-scss",
  sh: "text/x-shellscript",
  sql: "text/x-sql",
  swift: "text/x-swift",
  toml: "application/toml",
  ts: "text/x-typescript",
  tsx: "text/x-typescript",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/**
 * The MIME type ACP content should carry for the file at `path`, from its extension. `undefined`
 * when the extension says nothing, so the field is left out instead of guessed.
 */
export function getAcpMimeType(path: string): string | undefined {
  const name = getAcpPathBaseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return getImageMimeType(name) ?? MIME_TYPES[extension];
}
