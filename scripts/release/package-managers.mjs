#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { versionFromTag } from "./assets/policy.mjs";
import {
  parseChecksums,
  renderScoopManifest,
  renderWingetManifests,
} from "./package-managers/manifests.mjs";

const { values } = parseArgs({
  options: {
    tag: { type: "string" },
    repo: { type: "string", default: "athasdev/athas" },
    checksums: { type: "string" },
    "release-date": { type: "string" },
    out: { type: "string", default: "package-managers" },
  },
});

if (!values.tag || !values.checksums) {
  console.error(
    "Usage: bun scripts/release/package-managers.mjs --tag vX.Y.Z --checksums SHA256SUMS.txt [--release-date YYYY-MM-DD] [--out dir]",
  );
  process.exit(1);
}

const input = {
  tag: values.tag,
  repo: values.repo,
  checksums: parseChecksums(readFileSync(values.checksums, "utf8")),
  releaseDate: values["release-date"] ?? new Date().toISOString().slice(0, 10),
};

function writeAll(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
    console.log(join(dir, name));
  }
}

const version = versionFromTag(values.tag);
writeAll(
  join(values.out, "winget", "manifests", "a", "athasdev", "Athas", version),
  renderWingetManifests(input),
);
writeAll(join(values.out, "scoop", "bucket"), renderScoopManifest(input));
