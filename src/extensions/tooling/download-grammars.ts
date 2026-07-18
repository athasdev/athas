/**
 * Download parser WASM files from the extension CDN for local development.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SERVICE_DEFAULTS } from "@/config/service-defaults";
import {
  getExtensionCdnPath,
  getExtensionSourceDir,
  listExtensionFolders,
} from "./extension-workspace";
import { readFile } from "node:fs/promises";

const CDN_BASE_URL = process.env.EXTENSIONS_CDN_BASE_URL || SERVICE_DEFAULTS.extensionsCdnBaseUrl;

async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const buffer = await response.arrayBuffer();
    await writeFile(dest, Buffer.from(buffer));
    return true;
  } catch {
    return false;
  }
}

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const folder of await listExtensionFolders()) {
  const dir = getExtensionSourceDir(folder);
  const wasmPath = join(dir, "parser.wasm");

  if (existsSync(wasmPath)) {
    skipped++;
    continue;
  }

  const manifest = JSON.parse(await readFile(join(dir, "extension.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const cdnPath = getExtensionCdnPath(folder, manifest);
  const url = `${CDN_BASE_URL}/${cdnPath}/parser.wasm`;
  process.stdout.write(`Downloading ${cdnPath}/parser.wasm...`);

  await mkdir(dir, { recursive: true });
  if (await downloadFile(url, wasmPath)) {
    console.log(" ok");
    downloaded++;
  } else {
    console.log(" not found (skipped)");
    failed++;
  }
}

console.log(
  `\nDone: ${downloaded} downloaded, ${skipped} already present, ${failed} not available`,
);
