import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const tauriConfigPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");

const certificateThumbprint = process.env.WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
const timestampUrl = process.env.WINDOWS_TIMESTAMP_URL?.trim() || "http://time.certum.pl/";
const digestAlgorithm = process.env.WINDOWS_DIGEST_ALGORITHM?.trim() || "sha256";
const useTsp = process.env.WINDOWS_TIMESTAMP_USE_TSP?.trim().toLowerCase() === "true";

if (!certificateThumbprint) {
  throw new Error("WINDOWS_CERTIFICATE_THUMBPRINT is required to prepare Tauri Windows signing.");
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
tauriConfig.bundle ??= {};
tauriConfig.bundle.windows ??= {};
tauriConfig.bundle.windows.certificateThumbprint = certificateThumbprint;
tauriConfig.bundle.windows.digestAlgorithm = digestAlgorithm;
tauriConfig.bundle.windows.timestampUrl = timestampUrl;
tauriConfig.bundle.windows.tsp = useTsp;

writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const maskedThumbprint = `${certificateThumbprint.slice(0, 8)}...${certificateThumbprint.slice(-6)}`;
console.log(`Prepared Windows signing for thumbprint ${maskedThumbprint}`);
console.log(`Timestamp URL: ${timestampUrl}`);
console.log(`TSP enabled: ${useTsp}`);
