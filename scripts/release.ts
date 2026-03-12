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

type ReleaseChannel = "alpha" | "beta" | "rc";

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

function error(message: string) {
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
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/,
  );
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

function isReleaseChannel(value: string): value is ReleaseChannel {
  return value === "alpha" || value === "beta" || value === "rc";
}

function getStableBase(version: ParsedVersion): ParsedVersion {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch,
  };
}

function bumpStableBase(version: ParsedVersion, bumpType: string): ParsedVersion {
  const stable = getStableBase(version);

  switch (bumpType) {
    case "major":
      return { major: stable.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: stable.major, minor: stable.minor + 1, patch: 0 };
    case "patch":
      if (version.prerelease) {
        return stable;
      }
      return { major: stable.major, minor: stable.minor, patch: stable.patch + 1 };
    default:
      if (/^\d+\.\d+\.\d+$/.test(bumpType)) {
        return parseVersion(bumpType);
      }

      error(
        `Invalid bump type: ${bumpType}. Use: patch, minor, major, alpha, beta, rc, or an exact version`,
      );
      return stable;
  }
}

function bumpVersion(currentVersion: string, args: string[]): string {
  const current = parseVersion(currentVersion);
  const [firstArg, secondArg] = args;

  if (!firstArg) {
    error(
      "Please specify: patch, minor, major, alpha, beta, rc, or an exact version (e.g. 1.2.3 or 1.2.3-beta.1)",
    );
  }

  if (/^\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.\d+)?$/.test(firstArg)) {
    return formatVersion(parseVersion(firstArg));
  }

  if (isReleaseChannel(firstArg)) {
    let baseVersion: ParsedVersion;

    if (secondArg) {
      baseVersion = bumpStableBase(current, secondArg);
    } else if (current.prerelease) {
      baseVersion = getStableBase(current);
    } else {
      baseVersion = bumpStableBase(current, "patch");
    }

    const shouldIncrementExisting =
      current.prerelease?.channel === firstArg &&
      !secondArg &&
      current.major === baseVersion.major &&
      current.minor === baseVersion.minor &&
      current.patch === baseVersion.patch;

    return formatVersion({
      ...baseVersion,
      prerelease: {
        channel: firstArg,
        number: shouldIncrementExisting ? current.prerelease.number + 1 : 1,
      },
    });
  }

  return formatVersion(bumpStableBase(current, firstArg));
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
  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");
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

async function checkWorkingDirectory() {
  const status = await $`git status --porcelain`.text();
  if (status.trim().length > 0) {
    error(
      "Working directory is not clean. Please commit or stash your changes first.",
    );
  }
}

async function release() {
  log("\nStarting release process...\n", "magenta");

  const releaseArgs = process.argv.slice(2);

  if (!process.env.RELEASE_SKIP_CHECKS) {
    log("Running pre-release checks...\n", "magenta");
    await $`bun pre-release`;
    success("Pre-release checks passed");
  } else {
    info("Skipping pre-release checks because RELEASE_SKIP_CHECKS is set");
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
    `  1. Update package.json, tauri.conf.json, and Cargo.toml to v${newVersion}`,
    "yellow",
  );
  log("  2. Create a commit with these changes", "yellow");
  log(`  3. Create and push tag v${newVersion}`, "yellow");
  log("  4. Trigger GitHub Actions to build and release\n", "yellow");

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

  log("\n📦 Updating version files...\n", "magenta");

  await updatePackageJson(newVersion);
  await updateTauriConfig(newVersion);
  await updateCargoToml(newVersion);

  await $`git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`;
  success("Staged version changes");

  const commitMessage = `Bump version to ${newVersion}`;
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
  log(`GitHub Actions will now build and release v${newVersion}`, "cyan");
  log("View the progress at: https://github.com/athasdev/athas/actions\n", "cyan");
}

release().catch((err) => {
  error(`Release failed: ${err.message}`);
});
