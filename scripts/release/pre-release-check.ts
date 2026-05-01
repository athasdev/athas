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

function info(message: string) {
  log(`  ${message}`, "dim");
}

function parseStableVersion(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
}

function parsePrerelease(version: string): { channel: string; number: number } | null {
  const match = version.match(/-(preview)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    channel: match[1],
    number: parseInt(match[2]),
  };
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
  if (!Bun.file(dirPath).size && !(dirPath === process.cwd())) {
    // Keep missing directories as zero-sized.
    // Bun.file().size is 0 for missing files, so directory probing still relies on find below.
  }

  const files = Bun.spawnSync(["find", dirPath, "-type", "f"]).stdout.toString().trim().split("\n");
  for (const file of files) {
    if (file) {
      size += Bun.file(file).size;
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
  log("\n Release Check\n", "cyan");
  const runFullChecks = process.env.RELEASE_FULL_CHECKS === "1";
  log(
    runFullChecks
      ? "Running full release validation..."
      : "Running fast release readiness validation...",
    "dim",
  );

  // Get current version from package.json
  const pkgPath = `${process.cwd()}/package.json`;
  const pkg = JSON.parse(await Bun.file(pkgPath).text());
  const currentVersion = pkg.version;

  // Get version from tauri.conf.json
  const tauriConfigPath = `${process.cwd()}/src-tauri/tauri.conf.json`;
  const tauriConfig = JSON.parse(await Bun.file(tauriConfigPath).text());
  const tauriVersion = tauriConfig.version;
  const cargoTomlPath = `${process.cwd()}/src-tauri/Cargo.toml`;
  const cargoToml = await Bun.file(cargoTomlPath).text();
  const cargoVersionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  const cargoVersion = cargoVersionMatch?.[1];

  header("Version Info");
  log(`  Current version: v${currentVersion}`, "blue");

  const stableVersion = parseStableVersion(currentVersion);
  if (!stableVersion) {
    throw new Error(`Invalid version in package.json: ${currentVersion}`);
  }

  const prerelease = parsePrerelease(currentVersion);
  const { major, minor, patch } = stableVersion;
  if (prerelease) {
    log(`  Stable patch:    v${major}.${minor}.${patch}`, "dim");
    log(`  Preview patch:   v${major}.${minor}.${patch}-preview.${prerelease.number + 1}`, "dim");
  } else {
    log(`  Stable patch:    v${major}.${minor}.${patch + 1}`, "dim");
    log(`  Stable minor:    v${major}.${minor + 1}.0`, "dim");
    log(`  Stable major:    v${major + 1}.0.0`, "dim");
    log(`  Preview patch:   v${major}.${minor}.${patch + 1}-preview.1`, "dim");
    log(`  Preview minor:   v${major}.${minor + 1}.0-preview.1`, "dim");
    log(`  Preview major:   v${major + 1}.0.0-preview.1`, "dim");
  }

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

  await runCheck("Origin remote targets athasdev/athas", async () => {
    const remoteUrl = (await $`git remote get-url origin`.text()).trim();
    const isExpectedRemote =
      remoteUrl.includes("github.com/athasdev/athas") ||
      remoteUrl.includes("github.com:athasdev/athas");

    if (!isExpectedRemote) {
      return {
        passed: true,
        warning: true,
        message: `origin is '${remoteUrl}'`,
      };
    }

    return { passed: true };
  });

  // Check: Up to date with remote
  await runCheck("Up to date with remote", async () => {
    const fetchResult = await $`git fetch origin master`.quiet().nothrow();
    if (fetchResult.exitCode !== 0) {
      const cachedRemote = await $`git rev-parse --verify origin/master`.quiet().nothrow();
      if (cachedRemote.exitCode !== 0) {
        return {
          passed: true,
          warning: true,
          message: "Could not fetch origin/master in current environment",
        };
      }
    }

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

  // Check: Version consistency between versioned app files
  await runCheck("Version files stay in sync", async () => {
    if (!cargoVersion) {
      return {
        passed: false,
        message: "Could not find version in src-tauri/Cargo.toml",
      };
    }

    if (currentVersion !== tauriVersion || currentVersion !== cargoVersion) {
      return {
        passed: false,
        message: `package.json (${currentVersion}), tauri.conf.json (${tauriVersion}), Cargo.toml (${cargoVersion})`,
      };
    }
    return { passed: true };
  });

  header("Bundled Assets");

  // Check: Tree-sitter parsers are present
  await runCheck("Tree-sitter parsers", async () => {
    const parsersDir = `${process.cwd()}/public/tree-sitter/parsers`;
    const expectedLangs = [
      "bash",
      "c",
      "c_sharp",
      "cpp",
      "css",
      "dart",
      "elisp",
      "elixir",
      "go",
      "html",
      "java",
      "javascript",
      "json",
      "kotlin",
      "lua",
      "markdown",
      "objc",
      "ocaml",
      "php",
      "python",
      "rescript",
      "ruby",
      "rust",
      "scala",
      "solidity",
      "svelte",
      "sql",
      "swift",
      "systemrdl",
      "tlaplus",
      "toml",
      "tsx",
      "typescript",
      "vue",
      "yaml",
      "zig",
    ];

    const missing: string[] = [];
    for (const lang of expectedLangs) {
      const wasmPath = `${parsersDir}/${lang}/parser.wasm`;
      const queryPath = `${parsersDir}/${lang}/highlights.scm`;
      if (!(await Bun.file(wasmPath).exists())) missing.push(`${lang}/parser.wasm`);
      if (!(await Bun.file(queryPath).exists())) missing.push(`${lang}/highlights.scm`);
    }

    if (missing.length > 0) {
      return {
        passed: false,
        message: `${missing.length} missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""} (run: bun install)`,
      };
    }
    return { passed: true, message: `${expectedLangs.length} languages` };
  });

  if (runFullChecks) {
    header("Frontend Checks");

    // Check: TypeScript
    await runCheck("TypeScript type check", async () => {
      const result = await $`bun typecheck`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Type errors found" };
      }
      return { passed: true };
    });

    // Check: Vite+ lint and format
    await runCheck("Vite+ check", async () => {
      const result = await $`bunx vp check`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Format, lint, or type errors found" };
      }
      return { passed: true };
    });

    await runCheck("Vite+ test suite", async () => {
      const result = await $`bunx vp test run`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Tests failed" };
      }
      return { passed: true };
    });

    await runCheck("Vite+ build", async () => {
      const result = await $`bunx vp build`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Frontend build failed" };
      }
      return { passed: true };
    });

    await runCheck("Frontend bundle size < 80MB", async () => {
      const distPath = `${process.cwd()}/dist`;
      const size = getDirSize(distPath);
      const sizeStr = formatBytes(size);
      const maxSize = 80 * 1024 * 1024; // 80MB

      if (size > maxSize) {
        return { passed: true, warning: true, message: `${sizeStr} exceeds 80MB threshold` };
      }
      return { passed: true, message: sizeStr };
    });

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

    await runCheck("Cargo check (release)", async () => {
      const result = await $`cargo check --release -p athas`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Release-profile compilation errors found" };
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

    await runCheck("Cargo build (release)", async () => {
      const result = await $`cargo build --release`.quiet().nothrow();
      if (result.exitCode !== 0) {
        return { passed: false, message: "Release build failed" };
      }
      return { passed: true };
    });

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

      // sqlx-mysql currently pulls rsa 0.9.x, and RUSTSEC-2023-0071 has no
      // fixed upgrade available upstream. Keep the audit actionable by allowing
      // this one tracked advisory while still failing on newly fixable RustSec
      // vulnerabilities.
      const result = await $`cargo audit --no-fetch --ignore RUSTSEC-2023-0071`.quiet().nothrow();
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
  } else {
    header("Deferred Checks");
    warn("Frontend, Rust, and audit checks are skipped by default during release preparation");
    info("Run bun check for the full local validation suite");
  }

  header("Release Readiness");

  await runCheck("GitHub release workflow exists", async () => {
    const workflowPath = `${process.cwd()}/.github/workflows`;
    const workflowDirCheck = await $`test -d ${workflowPath}`.nothrow();
    if (workflowDirCheck.exitCode !== 0) {
      return { passed: false, message: "Missing .github/workflows directory" };
    }

    const releaseWorkflow = `${workflowPath}/release.yml`;
    const releaseAltWorkflow = `${workflowPath}/release.yaml`;
    const hasReleaseWorkflow =
      (await Bun.file(releaseWorkflow).exists()) || (await Bun.file(releaseAltWorkflow).exists());

    if (!hasReleaseWorkflow) {
      return { passed: true, warning: true, message: "No release workflow file found" };
    }

    return { passed: true };
  });

  await runCheck("Release asset verifier exists", async () => {
    const verifierPath = `${process.cwd()}/scripts/release/release-assets.mjs`;
    if (!(await Bun.file(verifierPath).exists())) {
      return { passed: false, message: "Missing scripts/release/release-assets.mjs" };
    }

    const result = await $`bun scripts/release/release-assets.mjs`.quiet().nothrow();
    if (result.exitCode !== 0) {
      return { passed: false, message: "Release asset verifier did not print usage successfully" };
    }

    return { passed: true };
  });

  header("Changes Since Last Release");

  // Get commits since last tag
  try {
    const lastTag = (await $`git tag --sort=-v:refname --list "v*"`.text())
      .split("\n")
      .map((tag) => tag.trim())
      .find(Boolean);

    if (!lastTag) {
      throw new Error("No version tags found");
    }

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
    log("    bun release:patch           # Stable patch draft", "dim");
    log("    bun release:minor           # Stable minor draft", "dim");
    log("    bun release:major           # Stable major draft", "dim");
    log("    bun release:preview         # Preview patch draft", "dim");
    log("    bun release:preview:minor   # Preview minor draft", "dim");
    log("    bun release:preview:major   # Preview major draft\n", "dim");
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
