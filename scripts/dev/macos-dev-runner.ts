#!/usr/bin/env bun

import path from "node:path";

interface TauriConfig {
  bundle?: {
    macOS?: {
      signingIdentity?: string | null;
    };
  };
}

const [binaryPath, ...appArgs] = Bun.argv.slice(2);

if (!binaryPath) {
  console.error("macOS dev runner requires the application binary path");
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tauriConfig = (await Bun.file(
  path.join(repoRoot, "src-tauri/tauri.conf.json"),
).json()) as TauriConfig;
const signingIdentity =
  process.env.APPLE_SIGNING_IDENTITY?.trim() || tauriConfig.bundle?.macOS?.signingIdentity?.trim();
const identifier = process.env.ATHAS_DEV_CODE_SIGN_IDENTIFIER?.trim();

if (signingIdentity && identifier) {
  const identities = Bun.spawnSync(["security", "find-identity", "-v", "-p", "codesigning"]);
  const identityIsAvailable =
    identities.exitCode === 0 && identities.stdout.toString().includes(`"${signingIdentity}"`);

  if (identityIsAvailable) {
    const signing = Bun.spawnSync([
      "codesign",
      "--force",
      "--sign",
      signingIdentity,
      "--timestamp=none",
      "--identifier",
      identifier,
      binaryPath,
    ]);

    if (signing.exitCode !== 0) {
      process.stderr.write(signing.stderr);
      process.exit(signing.exitCode);
    }
  } else {
    console.warn(`macOS dev signing identity is unavailable: ${signingIdentity}`);
  }
}

const application = Bun.spawn([binaryPath, ...appArgs], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const stop = (signal: NodeJS.Signals) => application.kill(signal);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

process.exit(await application.exited);
