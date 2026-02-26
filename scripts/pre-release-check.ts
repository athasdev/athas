#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Parse CLI flags
const args = process.argv.slice(2);
const fullMode = args.includes("--full") || args.includes("-f");

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(message: string) {
  console.log();
  log(`── ${message} ──`, "magenta");
}

function success(message: string) {
  log(`  [PASS] ${message}`, "green");
}

function fail(message: string) {
  log(`  [FAIL] ${message}`, "red");
}

function warn(message: string) {
  log(`  [WARN] ${message}`, "yellow");
}

function skip(message: string) {
  log(`  [SKIP] ${message}`, "dim");
}

function info(message: string) {
  log(`  ${message}`, "dim");
}

interface CheckResult {
  name: string;
  passed: boolean;
  warning?: boolean;
  message?: string;
}

const results: CheckResult[] = [];
const warnings: string[] = [];

async function runCheck(
  name: string,
  check: () => Promise<{ passed: boolean; warning?: boolean; message?: string }>,
): Promise<boolean> {
  try {
    const result = await check();
    results.push({ name, ...result });
    if (result.passed) {
      if (result.warning) {
        warn(`${name}${result.message ? `: ${result.message}` : ""}`);
        warnings.push(name);
      } else {
        success(name);
      }
    } else {
      fail(`${name}${result.message ? `: ${result.message}` : ""}`);
    }
    return result.passed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message });
    fail(`${name}: ${message}`);
    return false;
  }
}

function getDirSize(dirPath: string): number {
  let size = 0;
  if (!existsSync(dirPath)) return 0;

  const files = Bun.spawnSync(["find", dirPath, "-type", "f"]).stdout.toString().trim().split("\n");
  for (const file of files) {
    if (file && existsSync(file)) {
      size += statSync(file).size;
    }
  }
  return size;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  log("\n Pre-Release Check\n", "cyan");
  if (fullMode) {
    log("Running FULL checks (includes builds)...", "dim");
  } else {
    log("Running quick checks (use --full for build verification)...", "dim");
  }

  // Get current version from package.json
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const currentVersion = pkg.version;

  // Get version from tauri.conf.json
  const tauriConfigPath = join(process.cwd(), "src-tauri/tauri.conf.json");
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf-8"));
  const tauriVersion = tauriConfig.version;

  header("Version Info");
  log(`  Current version: v${currentVersion}`, "blue");

  // Calculate next versions
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  log(`  Next patch:      v${major}.${minor}.${patch + 1}`, "dim");
  log(`  Next minor:      v${major}.${minor + 1}.0`, "dim");
  log(`  Next major:      v${major + 1}.0.0`, "dim");

  header("Git Checks");

  // Check: Clean working directory
  await runCheck("Working directory is clean", async () => {
    const status = await $`git status --porcelain`.text();
    if (status.trim().length > 0) {
      return { passed: false, message: "Uncommitted changes detected" };
    }
    return { passed: true };
  });

  // Check: On master branch
  await runCheck("On master branch", async () => {
    const branch = await $`git branch --show-current`.text();
    if (branch.trim() !== "master") {
      return { passed: false, message: `Currently on '${branch.trim()}'` };
    }
    return { passed: true };
  });

  // Check: Up to date with remote
  await runCheck("Up to date with remote", async () => {
    await $`git fetch origin master`.quiet();
    const status = await $`git status -uno`.text();
    if (status.includes("Your branch is behind")) {
      return { passed: false, message: "Branch is behind origin/master" };
    }
    if (status.includes("have diverged")) {
      return { passed: false, message: "Branch has diverged from origin/master" };
    }
    return { passed: true };
  });

  header("Version Consistency");

  // Check: Version consistency between package.json and tauri.conf.json
  await runCheck("package.json matches tauri.conf.json", async () => {
    if (currentVersion !== tauriVersion) {
      return {
        passed: false,
        message: `package.json (${currentVersion}) != tauri.conf.json (${tauriVersion})`,
      };
    }
    return { passed: true };
  });

  header("Frontend Checks");

  // Check: TypeScript
  await runCheck("TypeScript type check", async () => {
    const result = await $`bun typecheck`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return { passed: false, message: "Type errors found" };
    }
    return { passed: true };
  });

  // Check: Biome lint
  await runCheck("Biome lint check", async () => {
    const result = await $`bun check`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return { passed: false, message: "Lint errors found" };
    }
    return { passed: true };
  });

  // Check: Vite build (full mode only)
  if (fullMode) {
    await runCheck("Vite build", async () => {
      const result = await $`bun vite build`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Frontend build failed" };
      }
      return { passed: true };
    });

    // Check: Bundle size
    await runCheck("Bundle size < 5MB", async () => {
      const distPath = join(process.cwd(), "dist");
      const size = getDirSize(distPath);
      const sizeStr = formatBytes(size);
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (size > maxSize) {
        return { passed: true, warning: true, message: `${sizeStr} exceeds 5MB threshold` };
      }
      return { passed: true, message: sizeStr };
    });
  } else {
    skip("Vite build (use --full)");
    skip("Bundle size check (use --full)");
  }

  header("Rust Checks");

  // Check: Cargo fmt
  await runCheck("Rust formatting", async () => {
    const result = await $`cargo fmt --check --all`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return { passed: false, message: "Formatting issues found" };
    }
    return { passed: true };
  });

  // Check: Cargo check
  await runCheck("Cargo check", async () => {
    const result = await $`cargo check --workspace`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return { passed: false, message: "Compilation errors found" };
    }
    return { passed: true };
  });

  // Check: Cargo clippy
  await runCheck("Cargo clippy", async () => {
    const result = await $`cargo clippy --workspace -- -D warnings`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return { passed: false, message: "Clippy warnings found" };
    }
    return { passed: true };
  });

  // Check: Cargo build release (full mode only)
  if (fullMode) {
    await runCheck("Cargo build (release)", async () => {
      const result = await $`cargo build --release`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Release build failed" };
      }
      return { passed: true };
    });
  } else {
    skip("Cargo build release (use --full)");
  }

  header("Security Audits");

  // Check: Cargo audit
  await runCheck("Cargo audit", async () => {
    // Check if cargo-audit is installed
    const which = await $`which cargo-audit`.quiet().nothrow();
    if (which.exitCode !== 0) {
      return {
        passed: true,
        warning: true,
        message: "cargo-audit not installed (run: cargo install cargo-audit)",
      };
    }

    const result = await $`cargo audit`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const output = result.stderr.toString();
      const vulnMatch = output.match(/(\d+) vulnerabilit/);
      const count = vulnMatch ? vulnMatch[1] : "some";
      return { passed: true, warning: true, message: `${count} vulnerabilities found` };
    }
    return { passed: true };
  });

  // Check: Bun audit
  await runCheck("Bun audit", async () => {
    // bun doesn't have native audit, use npm audit with bun's lockfile
    const result = await $`bunx npm-audit-resolver --json`.quiet().nothrow();
    if (result.exitCode !== 0) {
      // Try alternative: just run npm audit
      const npmResult = await $`npm audit --json`.quiet().nothrow();
      if (npmResult.exitCode !== 0) {
        try {
          const audit = JSON.parse(npmResult.stdout.toString());
          const vulns = audit.metadata?.vulnerabilities || {};
          const total = (vulns.high || 0) + (vulns.critical || 0);
          if (total > 0) {
            return {
              passed: true,
              warning: true,
              message: `${total} high/critical vulnerabilities`,
            };
          }
        } catch {
          return { passed: true, warning: true, message: "Could not parse audit results" };
        }
      }
    }
    return { passed: true };
  });

  header("Changes Since Last Release");

  // Get commits since last tag
  try {
    const lastTag = (await $`git describe --tags --abbrev=0`.text()).trim();
    const commits = await $`git log ${lastTag}..HEAD --oneline`.text();
    const commitList = commits.trim().split("\n").filter(Boolean);

    if (commitList.length === 0) {
      warn("No commits since last release");
    } else {
      log(`  ${commitList.length} commits since ${lastTag}:`, "blue");
      for (const commit of commitList.slice(0, 10)) {
        info(`    ${commit}`);
      }
      if (commitList.length > 10) {
        info(`    ... and ${commitList.length - 10} more`);
      }
    }
  } catch {
    warn("No previous tags found");
  }

  // Summary
  header("Summary");

  const passed = results.filter((r) => r.passed && !r.warning).length;
  const warned = warnings.length;
  const failed = results.filter((r) => !r.passed).length;

  if (failed === 0) {
    if (warned > 0) {
      log(`\n  ${passed} passed, ${warned} warnings\n`, "yellow");
    } else {
      log(`\n  All ${passed} checks passed!\n`, "green");
    }
    log("  Ready to release. Run one of:", "cyan");
    log("    bun release:patch  # Bug fixes", "dim");
    log("    bun release:minor  # New features", "dim");
    log("    bun release:major  # Breaking changes\n", "dim");
    process.exit(0);
  } else {
    log(`\n  ${passed} passed, ${warned} warnings, ${failed} failed\n`, "red");
    log("  Please fix the issues above before releasing.\n", "yellow");
    process.exit(1);
  }
}

main().catch((err) => {
  log(`\nError: ${err.message}\n`, "red");
  process.exit(1);
});
