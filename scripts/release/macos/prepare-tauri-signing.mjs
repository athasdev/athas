import { readFile, writeFile } from "node:fs/promises";

const signingEnabled = process.env.APPLE_CODE_SIGNING === "true";
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const tauriConfigPath = new URL("../../../src-tauri/tauri.conf.json", import.meta.url);

const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
tauriConfig.bundle ??= {};
tauriConfig.bundle.macOS ??= {};

if (!signingEnabled) {
  tauriConfig.bundle.macOS.signingIdentity = null;
  tauriConfig.bundle.macOS.providerShortName = null;
  await writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
  console.log("Apple code signing is not configured; building unsigned macOS bundles.");
  process.exit(0);
}

if (signingIdentity) {
  tauriConfig.bundle.macOS.signingIdentity = signingIdentity;
  await writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
  console.log(`Prepared macOS signing with identity: ${signingIdentity}`);
} else {
  console.log("Using macOS signing identity from Tauri config.");
}
