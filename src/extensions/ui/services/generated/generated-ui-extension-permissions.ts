import type { ExtensionPermissions } from "@/extensions/types/extension-manifest";

const MAX_NETWORK_ORIGINS = 5;
const PERMISSION_KEYS = new Set([
  "network",
  "secrets",
  "workspace",
  "openExternal",
  "clipboardWrite",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNetworkOrigin(value: unknown, index: number): string {
  if (typeof value !== "string" || value.includes("*")) {
    throw new Error(`Generated extension network permission ${index + 1} must be an exact origin`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Generated extension network permission ${index + 1} is invalid`);
  }

  const localHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new Error(
      `Generated extension network permission ${index + 1} must use HTTPS or local HTTP`,
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Generated extension network permission ${index + 1} must not include a path`);
  }

  return url.origin;
}

export function parseGeneratedExtensionPermissions(value: unknown): ExtensionPermissions {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error("Generated extension permissions must be an object");

  const unsupportedKey = Object.keys(value).find((key) => !PERMISSION_KEYS.has(key));
  if (unsupportedKey) {
    throw new Error(`Generated extension permission is not supported: ${unsupportedKey}`);
  }

  let network: string[] | undefined;
  if (value.network != null) {
    if (!Array.isArray(value.network) || value.network.length === 0) {
      throw new Error("Generated extension network permissions must be a non-empty array");
    }
    if (value.network.length > MAX_NETWORK_ORIGINS) {
      throw new Error(
        `Generated extensions may request at most ${MAX_NETWORK_ORIGINS} network origins`,
      );
    }
    network = [...new Set(value.network.map(parseNetworkOrigin))];
  }

  if (value.secrets != null && typeof value.secrets !== "boolean") {
    throw new Error("Generated extension secrets permission must be a boolean");
  }
  if (value.workspace != null && value.workspace !== "read") {
    throw new Error('Generated extension workspace permission must be "read"');
  }
  if (value.openExternal != null && typeof value.openExternal !== "boolean") {
    throw new Error("Generated extension external-link permission must be a boolean");
  }
  if (value.clipboardWrite != null && typeof value.clipboardWrite !== "boolean") {
    throw new Error("Generated extension clipboard-write permission must be a boolean");
  }

  return {
    ...(network ? { network } : {}),
    ...(value.secrets === true ? { secrets: true } : {}),
    ...(value.workspace === "read" ? { workspace: "read" as const } : {}),
    ...(value.openExternal === true ? { openExternal: true } : {}),
    ...(value.clipboardWrite === true ? { clipboardWrite: true } : {}),
  };
}

export function validateGeneratedExtensionPermissionUsage(
  code: string,
  permissions: ExtensionPermissions,
): void {
  const capabilities = [
    {
      used: /\bapi\.http\s*\./.test(code),
      granted: Boolean(permissions.network?.length),
      label: "network",
    },
    {
      used: /\bapi\.secrets\s*\./.test(code),
      granted: permissions.secrets === true,
      label: "secrets",
    },
    {
      used: /\bapi\.workspace\s*\./.test(code),
      granted: permissions.workspace === "read",
      label: "workspace read",
    },
    {
      used: /\bapi\.opener\s*\./.test(code),
      granted: permissions.openExternal === true,
      label: "external links",
    },
    {
      used: /\bapi\.clipboard\s*\./.test(code),
      granted: permissions.clipboardWrite === true,
      label: "clipboard write",
    },
  ];

  for (const capability of capabilities) {
    if (capability.used && !capability.granted) {
      throw new Error(`Generated extension uses ${capability.label} without requesting permission`);
    }
    if (!capability.used && capability.granted) {
      throw new Error(`Generated extension requests unused ${capability.label} permission`);
    }
  }
}
