#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`Usage:
  bun scripts/release/release-assets.mjs assemble --tag <tag> --repo <owner/repo> --dir <artifact-dir> --notes-file <file> --out <dir>
  bun scripts/release/release-assets.mjs validate-local --tag <tag> --dir <artifact-dir>
  bun scripts/release/release-assets.mjs verify --tag <tag> --repo <owner/repo>
  bun scripts/release/release-assets.mjs repair-plan --tag <tag> --repo <owner/repo>`);
}

function getArg(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }
  return fallback;
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function versionFromTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return tag.slice(1);
}

function channelFromTag(tag) {
  return tag.includes("-preview.") ? "preview" : "stable";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (stats.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function normalizedArtifactName(file, name, channel) {
  const appPrefix = channel === "preview" ? "Athas Preview" : "Athas";
  const macUpdaterName = `${appPrefix}.app.tar.gz`;

  if (name === macUpdaterName || name === `${macUpdaterName}.sig`) {
    if (file.includes("/aarch64-apple-darwin/")) {
      return name.replace(macUpdaterName, `${appPrefix}_aarch64.app.tar.gz`);
    }
    if (file.includes("/x86_64-apple-darwin/")) {
      return name.replace(macUpdaterName, `${appPrefix}_x64.app.tar.gz`);
    }
  }

  return name;
}

function indexFiles(dir, channel) {
  if (!existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }

  const byName = new Map();
  for (const file of walkFiles(dir)) {
    const name = normalizedArtifactName(file, basename(file), channel);
    if (byName.has(name)) {
      throw new Error(`Duplicate artifact filename found: ${name}`);
    }
    byName.set(name, file);
  }
  return byName;
}

function requiredAssets(version, channel) {
  const escapedVersion = escapeRegExp(version);
  const appPrefix = channel === "preview" ? "Athas Preview" : "Athas";
  return [
    {
      id: "macos-arm64-dmg",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_aarch64\\.dmg$`),
      checksum: true,
    },
    {
      id: "macos-x64-dmg",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_x64\\.dmg$`),
      checksum: true,
    },
    {
      id: "macos-arm64-updater",
      pattern: new RegExp(`^${appPrefix}_aarch64\\.app\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "macos-x64-updater",
      pattern: new RegExp(`^${appPrefix}_x64\\.app\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-x64-tarball",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_linux-x86_64\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-arm64-tarball",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_linux-aarch64\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "windows-x64-nsis",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_x64-setup\\.exe$`),
      signature: true,
      checksum: true,
    },
    {
      id: "windows-arm64-nsis",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_arm64-setup\\.exe$`),
      signature: true,
      checksum: true,
    },
  ];
}

function forbiddenAssetPatterns(version) {
  const escapedVersion = escapeRegExp(version);
  const appPrefix = "Athas(?: Preview)?";
  return [
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:x64|arm64)_en-US\\.msi(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:amd64|aarch64)\\.AppImage(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:amd64|arm64)\\.deb(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}-${escapedVersion}-1\\.(?:x86_64|aarch64)\\.rpm(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:x64|arm64)-setup-machine\\.exe(?:\\.sig)?$`),
  ];
}

function findRequiredAsset(filesByName, required) {
  const matches = [...filesByName.keys()].filter((name) => required.pattern.test(name));
  if (matches.length === 0) {
    throw new Error(`Missing required release asset: ${required.id}`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple assets match ${required.id}: ${matches.join(", ")}`);
  }

  const name = matches[0];
  if (required.signature && !filesByName.has(`${name}.sig`)) {
    throw new Error(`Missing signature for ${name}`);
  }

  return {
    ...required,
    name,
    path: filesByName.get(name),
    signatureName: required.signature ? `${name}.sig` : undefined,
    signaturePath: required.signature ? filesByName.get(`${name}.sig`) : undefined,
  };
}

function collectRequiredAssets(dir, version, channel) {
  const filesByName = indexFiles(dir, channel);
  for (const name of filesByName.keys()) {
    if (forbiddenAssetPatterns(version).some((pattern) => pattern.test(name))) {
      throw new Error(`Unexpected legacy release asset found: ${name}`);
    }
  }

  return {
    filesByName,
    assets: requiredAssets(version, channel).map((required) =>
      findRequiredAsset(filesByName, required),
    ),
  };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function releaseUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
}

function readSignature(path) {
  return readFileSync(path, "utf8").trim();
}

function assetById(assets, id) {
  const asset = assets.find((entry) => entry.id === id);
  if (!asset) {
    throw new Error(`Internal error: missing collected asset ${id}`);
  }
  return asset;
}

function buildLatestJson({ tag, repo, notes, assets }) {
  const version = versionFromTag(tag);
  const macArm = assetById(assets, "macos-arm64-updater");
  const macX64 = assetById(assets, "macos-x64-updater");
  const linuxX64Tarball = assetById(assets, "linux-x64-tarball");
  const linuxArmTarball = assetById(assets, "linux-arm64-tarball");
  const winX64Nsis = assetById(assets, "windows-x64-nsis");
  const winArmNsis = assetById(assets, "windows-arm64-nsis");

  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature: readSignature(macArm.signaturePath),
        url: releaseUrl(repo, tag, macArm.name),
      },
      "darwin-aarch64-app": {
        signature: readSignature(macArm.signaturePath),
        url: releaseUrl(repo, tag, macArm.name),
      },
      "darwin-x86_64": {
        signature: readSignature(macX64.signaturePath),
        url: releaseUrl(repo, tag, macX64.name),
      },
      "darwin-x86_64-app": {
        signature: readSignature(macX64.signaturePath),
        url: releaseUrl(repo, tag, macX64.name),
      },
      "linux-aarch64": {
        signature: readSignature(linuxArmTarball.signaturePath),
        url: releaseUrl(repo, tag, linuxArmTarball.name),
      },
      "linux-aarch64-tar.gz": {
        signature: readSignature(linuxArmTarball.signaturePath),
        url: releaseUrl(repo, tag, linuxArmTarball.name),
      },
      "linux-x86_64": {
        signature: readSignature(linuxX64Tarball.signaturePath),
        url: releaseUrl(repo, tag, linuxX64Tarball.name),
      },
      "linux-x86_64-tar.gz": {
        signature: readSignature(linuxX64Tarball.signaturePath),
        url: releaseUrl(repo, tag, linuxX64Tarball.name),
      },
      "windows-x86_64": {
        signature: readSignature(winX64Nsis.signaturePath),
        url: releaseUrl(repo, tag, winX64Nsis.name),
      },
      "windows-x86_64-nsis": {
        signature: readSignature(winX64Nsis.signaturePath),
        url: releaseUrl(repo, tag, winX64Nsis.name),
      },
      "windows-aarch64": {
        signature: readSignature(winArmNsis.signaturePath),
        url: releaseUrl(repo, tag, winArmNsis.name),
      },
      "windows-aarch64-nsis": {
        signature: readSignature(winArmNsis.signaturePath),
        url: releaseUrl(repo, tag, winArmNsis.name),
      },
    },
  };
}

function writeChecksums(outDir, assets) {
  const lines = assets
    .filter((asset) => asset.checksum)
    .map((asset) => `${sha256(asset.path)}  ${asset.name}`)
    .sort();
  writeFileSync(join(outDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

function copyReleaseFiles(outDir, filesByName) {
  mkdirSync(outDir, { recursive: true });
  let copiedCount = 0;
  for (const [name, path] of filesByName) {
    if (name === "latest.json" || name === "release-body.md" || name === "SHA256SUMS.txt") {
      continue;
    }
    copyFileSync(path, join(outDir, name));
    copiedCount += 1;
  }
  return copiedCount;
}

async function assemble() {
  const tag = requireArg("--tag");
  const repo = requireArg("--repo");
  const dir = requireArg("--dir");
  const notesFile = requireArg("--notes-file");
  const outDir = requireArg("--out");
  const version = versionFromTag(tag);
  const channel = channelFromTag(tag);
  const notes = readFileSync(notesFile, "utf8");
  const { filesByName, assets } = collectRequiredAssets(dir, version, channel);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const copiedCount = copyReleaseFiles(outDir, filesByName);
  writeFileSync(
    join(outDir, "latest.json"),
    `${JSON.stringify(buildLatestJson({ tag, repo, notes, assets }), null, 2)}\n`,
  );
  writeChecksums(outDir, assets);
  console.log(`Prepared ${copiedCount + 2} release files in ${outDir}`);
}

function validateLatestJson(latestJson, { tag, repo, assetNames }) {
  const version = versionFromTag(tag);
  if (latestJson.version !== version) {
    throw new Error(`latest.json version is ${latestJson.version}, expected ${version}`);
  }

  const requiredPlatforms = [
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "linux-aarch64",
    "linux-aarch64-tar.gz",
    "linux-x86_64",
    "linux-x86_64-tar.gz",
    "windows-x86_64",
    "windows-x86_64-nsis",
    "windows-aarch64",
    "windows-aarch64-nsis",
  ];

  for (const platform of requiredPlatforms) {
    const entry = latestJson.platforms?.[platform];
    if (!entry) {
      throw new Error(`latest.json missing platform ${platform}`);
    }
    if (!entry.signature || typeof entry.signature !== "string") {
      throw new Error(`latest.json platform ${platform} is missing a signature`);
    }
    if (!entry.url || typeof entry.url !== "string") {
      throw new Error(`latest.json platform ${platform} is missing a URL`);
    }
    if (!entry.url.startsWith(`https://github.com/${repo}/releases/download/${tag}/`)) {
      throw new Error(`latest.json platform ${platform} points outside ${tag}: ${entry.url}`);
    }

    const assetName = decodeURIComponent(entry.url.split("/").at(-1));
    if (!assetNames.has(assetName)) {
      throw new Error(`latest.json platform ${platform} references missing asset ${assetName}`);
    }
  }
}

function validateChecksumFile(checksumText, expectedAssets) {
  const checksumNames = new Set(
    checksumText
      .split("\n")
      .map((line) => line.match(/^[a-f0-9]{64}\s{2}(.+)$/)?.[1])
      .filter(Boolean),
  );

  for (const asset of expectedAssets.filter((entry) => entry.checksum)) {
    if (!checksumNames.has(asset.name)) {
      throw new Error(`SHA256SUMS.txt missing ${asset.name}`);
    }
  }
}

function validateLocal() {
  const tag = requireArg("--tag");
  const dir = requireArg("--dir");
  const repo = getArg("--repo", "athasdev/athas");
  const version = versionFromTag(tag);
  const channel = channelFromTag(tag);
  const { filesByName, assets } = collectRequiredAssets(dir, version, channel);

  if (!filesByName.has("latest.json")) {
    throw new Error("Missing latest.json");
  }

  if (filesByName.has("latest.json")) {
    validateLatestJson(JSON.parse(readFileSync(filesByName.get("latest.json"), "utf8")), {
      tag,
      repo,
      assetNames: new Set(filesByName.keys()),
    });
  }

  if (filesByName.has("SHA256SUMS.txt")) {
    validateChecksumFile(readFileSync(filesByName.get("SHA256SUMS.txt"), "utf8"), assets);
  }

  console.log(`Validated ${assets.length} required release assets for ${tag}`);
}

function gh(args, options = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `gh ${args.join(" ")} failed`);
  }

  return result.stdout;
}

function getRemoteReleases(repo, tag) {
  const output = gh(["api", `/repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"]);
  return JSON.parse(output)
    .flat()
    .filter((release) => release.tag_name === tag);
}

function getRemoteRelease(repo, tag) {
  const output = gh([
    "release",
    "view",
    tag,
    "--repo",
    repo,
    "--json",
    "assets,isDraft,name,tagName,url",
  ]);
  return JSON.parse(output);
}

function verifyRemote({ planOnly = false } = {}) {
  const tag = requireArg("--tag");
  const repo = requireArg("--repo");
  const version = versionFromTag(tag);
  const channel = channelFromTag(tag);
  const problems = [];

  let releases = [];
  try {
    releases = getRemoteReleases(repo, tag);
  } catch (error) {
    problems.push(`Could not list releases: ${error.message}`);
  }

  if (releases.length === 0) {
    problems.push(`No release found for ${tag}`);
  } else if (releases.length > 1) {
    problems.push(`Found ${releases.length} releases with tag ${tag}`);
  }

  let release;
  try {
    release = getRemoteRelease(repo, tag);
  } catch (error) {
    problems.push(`Could not view release ${tag}: ${error.message}`);
  }

  if (release) {
    const assetNames = new Set(release.assets.map((asset) => asset.name));
    const fakeDir = mkdtempSync(join(tmpdir(), "athas-release-assets-"));
    try {
      for (const name of assetNames) {
        writeFileSync(join(fakeDir, name), "");
      }
      const { assets } = collectRequiredAssets(fakeDir, version, channel);

      for (const required of ["latest.json", "SHA256SUMS.txt"]) {
        if (!assetNames.has(required)) {
          problems.push(`Missing ${required}`);
        }
      }

      if (assetNames.has("latest.json")) {
        const latestDir = mkdtempSync(join(tmpdir(), "athas-latest-json-"));
        try {
          gh([
            "release",
            "download",
            tag,
            "--repo",
            repo,
            "--pattern",
            "latest.json",
            "--dir",
            latestDir,
            "--clobber",
          ]);
          validateLatestJson(JSON.parse(readFileSync(join(latestDir, "latest.json"), "utf8")), {
            tag,
            repo,
            assetNames,
          });
        } catch (error) {
          problems.push(error.message);
        } finally {
          rmSync(latestDir, { recursive: true, force: true });
        }
      }

      if (assetNames.has("SHA256SUMS.txt")) {
        const checksumDir = mkdtempSync(join(tmpdir(), "athas-checksums-"));
        try {
          gh([
            "release",
            "download",
            tag,
            "--repo",
            repo,
            "--pattern",
            "SHA256SUMS.txt",
            "--dir",
            checksumDir,
            "--clobber",
          ]);
          validateChecksumFile(readFileSync(join(checksumDir, "SHA256SUMS.txt"), "utf8"), assets);
        } catch (error) {
          problems.push(error.message);
        } finally {
          rmSync(checksumDir, { recursive: true, force: true });
        }
      }
    } catch (error) {
      problems.push(error.message);
    } finally {
      rmSync(fakeDir, { recursive: true, force: true });
    }
  }

  if (problems.length === 0) {
    console.log(`${tag} is complete for ${repo}`);
    return;
  }

  if (planOnly) {
    console.log(`Repair plan for ${repo} ${tag}:`);
    for (const problem of problems) {
      console.log(`- ${problem}`);
    }
    console.log(
      "- Re-run the release workflow after fixing the missing or duplicated release state.",
    );
    return;
  }

  throw new Error(`Release verification failed:\n- ${problems.join("\n- ")}`);
}

try {
  if (command === "assemble") {
    await assemble();
  } else if (command === "validate-local") {
    validateLocal();
  } else if (command === "verify") {
    verifyRemote();
  } else if (command === "repair-plan") {
    verifyRemote({ planOnly: true });
  } else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
