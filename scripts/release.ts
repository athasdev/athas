#!/usr/bin/env bun
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ANSI colors for pretty output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message: string) {
  log(`❌ ${message}`, "red");
  process.exit(1);
}

function success(message: string) {
  log(`✅ ${message}`, "green");
}

function info(message: string) {
  log(`ℹ️  ${message}`, "cyan");
}

// Parse semver version
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
}

// Bump version based on type
function bumpVersion(currentVersion: string, bumpType: string): string {
  const { major, minor, patch } = parseVersion(currentVersion);

  switch (bumpType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      // Check if it's a valid version string
      if (/^\d+\.\d+\.\d+$/.test(bumpType)) {
        return bumpType;
      }
      error(`Invalid bump type: ${bumpType}. Use: patch, minor, major, or a version number (e.g., 1.2.3)`);
      return ""; // unreachable
  }
}

// Get commits since last tag
async function getCommitsSinceLastTag(): Promise<string[]> {
  try {
    // Get the last tag
    const lastTag = await $`git describe --tags --abbrev=0`.text();
    const tag = lastTag.trim();

    // Get commits since that tag
    const commits = await $`git log ${tag}..HEAD --pretty=format:"%s"`.text();
    return commits
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    // No previous tags, get all commits
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

// Update package.json version
function updatePackageJson(newVersion: string) {
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  success(`Updated package.json to v${newVersion}`);
}

// Update tauri.conf.json version
function updateTauriConfig(newVersion: string) {
  const configPath = join(process.cwd(), "src-tauri/tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  config.version = newVersion;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  success(`Updated tauri.conf.json to v${newVersion}`);
}

// Check if working directory is clean
async function checkWorkingDirectory() {
  const status = await $`git status --porcelain`.text();
  if (status.trim().length > 0) {
    error("Working directory is not clean. Please commit or stash your changes first.");
  }
}

// Main release function
async function release() {
  log("\n🚀 Starting release process...\n", "magenta");

  // Get bump type from command line args
  const bumpType = process.argv[2];
  if (!bumpType) {
    error("Please specify bump type: patch, minor, major, or a version number (e.g., 1.2.3)");
  }

  // Check if working directory is clean
  await checkWorkingDirectory();

  // Read current version
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const currentVersion = pkg.version;

  info(`Current version: ${currentVersion}`);

  // Calculate new version
  const newVersion = bumpVersion(currentVersion, bumpType);
  info(`New version: ${newVersion}`);

  // Get commits for changelog
  log("\n📝 Generating changelog...\n", "yellow");
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

  // Confirm release
  log("\n⚠️  This will:", "yellow");
  log(`  1. Update package.json and tauri.conf.json to v${newVersion}`, "yellow");
  log(`  2. Create a commit with these changes`, "yellow");
  log(`  3. Create and push tag v${newVersion}`, "yellow");
  log(`  4. Trigger GitHub Actions to build and release\n`, "yellow");

  // In non-interactive mode (CI), skip confirmation
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

  // Update versions
  updatePackageJson(newVersion);
  updateTauriConfig(newVersion);

  // Git add
  await $`git add package.json src-tauri/tauri.conf.json`;
  success("Staged version changes");

  // Create commit
  const commitMessage = `Bump version to ${newVersion}`;
  await $`git commit -m ${commitMessage}`;
  success(`Created commit: ${commitMessage}`);

  // Create tag
  await $`git tag v${newVersion}`;
  success(`Created tag: v${newVersion}`);

  // Push changes and tag
  log("\n🚀 Pushing to remote...\n", "magenta");
  await $`git push origin master`;
  success("Pushed commits");

  await $`git push origin v${newVersion}`;
  success("Pushed tag");

  log("\n✨ Release process complete!\n", "green");
  log(`GitHub Actions will now build and release v${newVersion}`, "cyan");
  log(`View the progress at: https://github.com/athasdev/athas/actions\n`, "cyan");
}

// Run the release
release().catch((err) => {
  error(`Release failed: ${err.message}`);
});
