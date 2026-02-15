#!/usr/bin/env bun

import { $ } from "bun";
import { join } from "node:path";

const sourceDir = join(process.cwd(), "extensions");
const targetDir = process.env.EXTENSIONS_CDN_ROOT;

if (!targetDir) {
  console.error("Missing EXTENSIONS_CDN_ROOT environment variable.");
  process.exit(1);
}

console.log(`Syncing extensions CDN content...`);
console.log(`Source: ${sourceDir}/`);
console.log(`Target: ${targetDir}/`);

await $`mkdir -p ${targetDir}`;
await $`rsync -az --delete ${sourceDir}/ ${targetDir}/`;

console.log("Extensions CDN sync complete.");
