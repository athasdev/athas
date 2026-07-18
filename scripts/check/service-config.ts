#!/usr/bin/env bun

export type Services = {
  websiteBaseUrl: string;
  stableUpdateUrl: string;
  previewUpdateUrl: string;
};

export type TauriConfig = {
  app?: { security?: { csp?: string } };
  plugins?: { updater?: { endpoints?: string[] } };
};

export type CapabilityConfig = {
  permissions?: Array<string | { allow?: Array<{ url?: string }> }>;
};

type ServiceConfigInput = {
  services: Services;
  stable: TauriConfig;
  preview: TauriConfig;
  capability: CapabilityConfig;
};

export function getServiceConfigErrors({
  services,
  stable,
  preview,
  capability,
}: ServiceConfigInput): string[] {
  const errors: string[] = [];
  const allowedUrls =
    capability.permissions?.flatMap((permission) =>
      typeof permission === "string" ? [] : permission.allow || [],
    ) || [];

  for (const [name, value] of Object.entries(services)) {
    if (typeof value !== "string" || !value.startsWith("https://")) {
      errors.push(`${name} must be a public HTTPS URL.`);
    }
  }

  if (stable.plugins?.updater?.endpoints?.[0] !== services.stableUpdateUrl) {
    errors.push("Stable Tauri updater endpoint does not match src/config/services.json.");
  }

  if (preview.plugins?.updater?.endpoints?.[0] !== services.previewUpdateUrl) {
    errors.push("Preview Tauri updater endpoint does not match src/config/services.json.");
  }

  if (!stable.app?.security?.csp?.includes(services.websiteBaseUrl)) {
    errors.push("Tauri CSP does not allow the configured Athas website origin.");
  }

  if (!allowedUrls.some((entry) => entry.url === `${services.websiteBaseUrl}/**`)) {
    errors.push("Tauri capabilities do not allow the configured Athas website origin.");
  }

  return errors;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

async function main() {
  const errors = getServiceConfigErrors({
    services: await readJson<Services>("src/config/services.json"),
    stable: await readJson<TauriConfig>("src-tauri/tauri.conf.json"),
    preview: await readJson<TauriConfig>("src-tauri/tauri.preview.conf.json"),
    capability: await readJson<CapabilityConfig>("src-tauri/capabilities/main.json"),
  });

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log("Athas service configuration is consistent across frontend and Tauri.");
}

if (import.meta.main) {
  await main();
}
