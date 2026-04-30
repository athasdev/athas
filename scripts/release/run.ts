#!/usr/bin/env bun
import { $ } from "bun";

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

type ReleaseChannel = "preview";
type ReleaseBump = "patch" | "minor" | "major";
const VERSIONED_FILES = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "Cargo.lock",
] as const;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: {
    channel: ReleaseChannel;
    number: number;
  };
}

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message: string): never {
  log(message, "red");
  process.exit(1);
}

function success(message: string) {
  log(message, "green");
}

function info(message: string) {
  log(message, "cyan");
}

function parseVersion(version: string): ParsedVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(preview)\.(\d+))?$/);
  if (!match) {
    error(`Invalid version format: ${version}`);
  }

  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease:
      match[4] && match[5]
        ? {
            channel: match[4] as ReleaseChannel,
            number: parseInt(match[5]),
          }
        : undefined,
  };
}

function formatVersion(version: ParsedVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  if (!version.prerelease) {
    return base;
  }

  return `${base}-${version.prerelease.channel}.${version.prerelease.number}`;
}

function getReleaseCommitMessage(version: ParsedVersion): string {
  if (version.prerelease) {
    return "Prepare preview release";
  }

  return "Prepare release";
}

function getStableBase(version: ParsedVersion): ParsedVersion {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch,
  };
}

function bumpStableBase(version: ParsedVersion, bump: ReleaseBump): ParsedVersion {
  const stable = getStableBase(version);

  switch (bump) {
    case "major":
      return { major: stable.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: stable.major, minor: stable.minor + 1, patch: 0 };
    case "patch":
      if (version.prerelease) {
        return stable;
      }
      return { major: stable.major, minor: stable.minor, patch: stable.patch + 1 };
  }
}

function bumpVersion(currentVersion: string, args: string[]): string {
  const current = parseVersion(currentVersion);
  const [channel = "stable", bump = "patch"] = args;

  if (bump !== "patch" && bump !== "minor" && bump !== "major") {
    error("Invalid release bump. Use: patch, minor, or major");
  }

  const baseVersion = bumpStableBase(current, bump);

  if (channel === "stable") {
    return formatVersion(baseVersion);
  }

  if (channel === "preview") {
    const shouldIncrementExisting =
      current.prerelease?.channel === "preview" &&
      bump === "patch" &&
      current.major === baseVersion.major &&
      current.minor === baseVersion.minor &&
      current.patch === baseVersion.patch;

    return formatVersion({
      ...baseVersion,
      prerelease: {
        channel: "preview",
        number: shouldIncrementExisting ? current.prerelease.number + 1 : 1,
      },
    });
  }

  error("Invalid release channel. Use: stable or preview");
}

async function getCommitsSinceLastTag(): Promise<string[]> {
  try {
    const lastTag = await $`git describe --tags --abbrev=0`.text();
    const tag = lastTag.trim();

    const commits = await $`git log ${tag}..HEAD --pretty=format:"%s"`.text();
    return commits
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    try {
      const commits = await $`git log --pretty=format:"%s"`.text();
      return commits
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }
}

async function updatePackageJson(newVersion: string) {
  const pkgPath = `${process.cwd()}/package.json`;
  const pkg = JSON.parse(await Bun.file(pkgPath).text());
  pkg.version = newVersion;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  success(`Updated package.json to v${newVersion}`);
}

async function updateTauriConfig(newVersion: string) {
  const configPath = `${process.cwd()}/src-tauri/tauri.conf.json`;
  const config = JSON.parse(await Bun.file(configPath).text());
  config.version = newVersion;
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
  success(`Updated tauri.conf.json to v${newVersion}`);
}

async function updateCargoToml(newVersion: string) {
  const cargoPath = `${process.cwd()}/src-tauri/Cargo.toml`;
  const cargoToml = await Bun.file(cargoPath).text();
  const updatedCargoToml = cargoToml.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${newVersion}"`,
  );

  if (updatedCargoToml === cargoToml) {
    error("Could not update version in src-tauri/Cargo.toml");
  }

  await Bun.write(cargoPath, updatedCargoToml);
  success(`Updated src-tauri/Cargo.toml to v${newVersion}`);
}

async function updateCargoLock() {
  const result = await $`cargo check -p athas`.quiet().nothrow().cwd(process.cwd());

  if (result.exitCode !== 0) {
    error("Could not refresh Cargo.lock");
  }

  success("Updated Cargo.lock");
}

async function checkWorkingDirectory() {
  const status = await $`git status --porcelain`.text();
  if (status.trim().length > 0) {
    error("Working directory is not clean. Please commit or stash your changes first.");
  }
}

async function release() {
  log("\nStarting release process...\n", "magenta");

  const rawArgs = process.argv.slice(2);
  const isDryRun = rawArgs.includes("--dry-run");
  const releaseArgs = rawArgs.filter((arg) => arg !== "--dry-run");

  if (!process.env.RELEASE_SKIP_CHECKS) {
    log("Running release checks...\n", "magenta");
    await $`bun release:check`;
    success("Release checks passed");
  } else {
    info("Skipping release checks because RELEASE_SKIP_CHECKS is set");
  }

  await checkWorkingDirectory();

  const pkgPath = `${process.cwd()}/package.json`;
  const pkg = JSON.parse(await Bun.file(pkgPath).text());
  const currentVersion = pkg.version;

  info(`Current version: ${currentVersion}`);

  const newVersion = bumpVersion(currentVersion, releaseArgs);
  const parsedNewVersion = parseVersion(newVersion);
  info(`New version: ${newVersion}`);

  log("\nFetching recent commits...\n", "yellow");
  const commits = await getCommitsSinceLastTag();

  if (commits.length === 0) {
    log("No commits since last release", "yellow");
  } else {
    log(`Found ${commits.length} commits:`, "blue");
    commits.slice(0, 10).forEach((commit) => {
      log(`  - ${commit}`, "blue");
    });
    if (commits.length > 10) {
      log(`  ... and ${commits.length - 10} more`, "blue");
    }
  }

  log("\n  This will:", "yellow");
  log(
    `  1. Update package.json, tauri.conf.json, Cargo.toml, and Cargo.lock to v${newVersion}`,
    "yellow",
  );
  if (isDryRun) {
    log("  2. Verify the working tree diff locally", "yellow");
    log("  3. Restore all touched files without commit, tag, or push\n", "yellow");
  } else {
    log("  2. Create a commit with these changes", "yellow");
    log(`  3. Create and push tag v${newVersion}`, "yellow");
    log("  4. Trigger GitHub Actions to build a draft release\n", "yellow");
  }

  if (parsedNewVersion.prerelease) {
    info(
      `Release channel: ${parsedNewVersion.prerelease.channel} (#${parsedNewVersion.prerelease.number})`,
    );
  } else {
    info("Release channel: stable");
  }

  if (!process.stdin.isTTY) {
    info("Running in non-interactive mode, proceeding...");
  } else {
    const confirm = prompt("Continue? (y/N): ");
    if (confirm?.toLowerCase() !== "y") {
      log("Cancelled", "yellow");
      process.exit(0);
    }
  }

  const originalFiles = new Map<string, string>();

  for (const filePath of VERSIONED_FILES) {
    originalFiles.set(filePath, await Bun.file(`${process.cwd()}/${filePath}`).text());
  }

  log("\n📦 Updating version files...\n", "magenta");

  try {
    await updatePackageJson(newVersion);
    await updateTauriConfig(newVersion);
    await updateCargoToml(newVersion);
    await updateCargoLock();

    if (isDryRun) {
      const diffStat = (await $`git diff --stat -- ${VERSIONED_FILES}`.text()).trim();
      if (diffStat.length > 0) {
        log(diffStat, "blue");
      }
      success("Dry run updated version files locally");
      return;
    }

    await $`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock`;
    success("Staged version changes");

    const commitMessage = getReleaseCommitMessage(parsedNewVersion);
    await $`git commit -m ${commitMessage}`;
    success(`Created commit: ${commitMessage}`);

    await $`git tag v${newVersion}`;
    success(`Created tag: v${newVersion}`);

    log("\nPushing to remote...\n", "magenta");
    await $`git push origin master`;
    success("Pushed commits");

    await $`git push origin v${newVersion}`;
    success("Pushed tag");

    log("\n✨ Release process complete!\n", "green");
    log(`GitHub Actions will now build draft release v${newVersion}`, "cyan");
    log("View the progress at: https://github.com/athasdev/athas/actions\n", "cyan");
    log(
      `After the workflow finishes, verify it with: bun release:verify --tag v${newVersion}`,
      "cyan",
    );
    log(
      `Publish v${newVersion} manually from the GitHub draft release when it looks correct.\n`,
      "cyan",
    );
  } finally {
    if (isDryRun) {
      for (const [filePath, contents] of originalFiles) {
        await Bun.write(`${process.cwd()}/${filePath}`, contents);
      }
      success("Dry run restored version files");
    }
  }
}

release().catch((err) => {
  error(`Release failed: ${err.message}`);
});
