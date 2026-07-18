#!/usr/bin/env bun

type Services = {
  websiteBaseUrl: string;
  stableUpdateUrl: string;
  previewUpdateUrl: string;
};

type TauriConfig = {
  app?: { security?: { csp?: string } };
  plugins?: { updater?: { endpoints?: string[] } };
};

type CapabilityConfig = {
  permissions?: Array<string | { allow?: Array<{ url?: string }> }>;
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const services = await readJson<Services>("src/config/services.json");
const stable = await readJson<TauriConfig>("src-tauri/tauri.conf.json");
const preview = await readJson<TauriConfig>("src-tauri/tauri.preview.conf.json");
const capability = await readJson<CapabilityConfig>("src-tauri/capabilities/main.json");
const allowedUrls =
  capability.permissions?.flatMap((permission) =>
    typeof permission === "string" ? [] : permission.allow || [],
  ) || [];

for (const [name, value] of Object.entries(services)) {
  assert(
    typeof value === "string" && value.startsWith("https://"),
    `${name} must be a public HTTPS URL.`,
  );
}

assert(
  stable.plugins?.updater?.endpoints?.[0] === services.stableUpdateUrl,
  "Stable Tauri updater endpoint does not match src/config/services.json.",
);
assert(
  preview.plugins?.updater?.endpoints?.[0] === services.previewUpdateUrl,
  "Preview Tauri updater endpoint does not match src/config/services.json.",
);
assert(
  stable.app?.security?.csp?.includes(services.websiteBaseUrl),
  "Tauri CSP does not allow the configured Athas website origin.",
);
assert(
  allowedUrls.some((entry) => entry.url === `${services.websiteBaseUrl}/**`),
  "Tauri capabilities do not allow the configured Athas website origin.",
);

console.log("Athas service configuration is consistent across frontend and Tauri.");
