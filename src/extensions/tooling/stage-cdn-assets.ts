#!/usr/bin/env bun

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import {
  getExtensionCdnPath,
  getExtensionSourceDir,
  getGeneratedCdnPath,
  listExtensionFolders,
} from "./extension-workspace";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

await mkdir(getGeneratedCdnPath(), { recursive: true });

for (const folder of await listExtensionFolders()) {
  const sourceDir = getExtensionSourceDir(folder);
  const manifest = JSON.parse(await readFile(join(sourceDir, "extension.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const cdnPath = getExtensionCdnPath(folder, manifest);
  const targetDir = getGeneratedCdnPath(cdnPath);

  await mkdir(targetDir, { recursive: true });
  await $`rsync -az --delete \
    --exclude='.DS_Store' \
    --exclude='node_modules' \
    --exclude='build/node_modules' \
    --exclude='*.tar.gz' \
    ${sourceDir}/ ${targetDir}/`;
}

console.log("Staged extension CDN assets.");
