import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const tauriDir = path.join(repoRoot, "src-tauri");

type PermissionEntry = string | { identifier: string; allow?: Record<string, unknown>[] };
type Capability = {
  identifier: string;
  permissions: PermissionEntry[];
  remote?: { urls: string[] };
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readCapabilities(): Capability[] {
  const dir = path.join(tauriDir, "capabilities");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson<Capability>(path.join(dir, name)));
}

function permissionIds(capability: Capability): string[] {
  return capability.permissions.map((entry) =>
    typeof entry === "string" ? entry : entry.identifier,
  );
}

function findPermission(identifier: string) {
  for (const capability of readCapabilities()) {
    for (const entry of capability.permissions) {
      if (typeof entry !== "string" && entry.identifier === identifier) return entry;
    }
  }
  return undefined;
}

function readTauriConfigs() {
  return fs
    .readdirSync(tauriDir)
    .filter((name) => /^tauri(\..+)?\.conf\.json$/.test(name))
    .map((name) => ({ name, config: readJson<Record<string, any>>(path.join(tauriDir, name)) }));
}

// Permissions that hand the frontend a whole plugin, arbitrary process
// execution, or unscoped filesystem access. Add plugin commands one by one
// instead, and only the ones the frontend calls.
const FORBIDDEN_PERMISSIONS = [
  /^(?!core:).+:default$/,
  /^shell:/,
  /:allow-execute$/,
  /:allow-spawn$/,
  /:allow-kill$/,
  /:allow-stdin-write$/,
  /^opener:allow-open-path$/,
  /^opener:allow-default-urls$/,
  /^fs:(read|write)-all$/,
  /^fs:allow-.*-recursive$/,
  /^fs:allow-watch$/,
  /^fs:allow-rename$/,
  /^fs:allow-open$/,
  /^updater:allow-(download|install)$/,
];

describe("Tauri security surface", () => {
  it("grants explicit plugin commands instead of broad permission sets", () => {
    for (const capability of readCapabilities()) {
      for (const id of permissionIds(capability)) {
        const match = FORBIDDEN_PERMISSIONS.find((pattern) => pattern.test(id));
        expect(match, `${capability.identifier} grants ${id}`).toBeUndefined();
      }
    }
  });

  it("gives remote pages no capabilities", () => {
    // Browser tabs are wry webviews outside Tauri's webview manager and talk to the
    // workbench only through their own bridge, so no capability needs remote URLs.
    for (const capability of readCapabilities()) {
      expect(capability.remote, `${capability.identifier} remote`).toBeUndefined();
    }
  });

  it("only opens web, mail and phone links through the opener", () => {
    const openUrl = findPermission("opener:allow-open-url");
    expect(openUrl?.allow?.length).toBeGreaterThan(0);
    for (const entry of openUrl?.allow ?? []) {
      expect(Object.keys(entry)).toEqual(["url"]);
      expect(entry.url).toMatch(/^(https?:\/\/\*|mailto:\*|tel:\*)$/);
    }
  });

  it("keeps the asset protocol limited to app-owned directories", () => {
    for (const { name, config } of readTauriConfigs()) {
      const assetProtocol = config.app?.security?.assetProtocol;
      if (!assetProtocol?.enable) continue;
      const scope = assetProtocol.scope;
      const allow: unknown[] = Array.isArray(scope) ? scope : (scope?.allow ?? []);
      expect(allow.length, `${name} asset scope`).toBeGreaterThan(0);
      for (const entry of allow) {
        expect(typeof entry, `${name} asset scope entry`).toBe("string");
        expect(entry, `${name} asset scope entry`).toMatch(
          /^\$(APPDATA|APPLOCALDATA|APPCACHE|APPCONFIG|APPLOG|RESOURCE)\//,
        );
      }
    }
  });

  it("keeps a restrictive content security policy", () => {
    for (const { name, config } of readTauriConfigs()) {
      const csp = config.app?.security?.csp;
      if (csp === undefined) continue;
      expect(typeof csp, `${name} must define a CSP string`).toBe("string");
      const directives = new Map<string, string[]>(
        (csp as string)
          .split(";")
          .map((part) => part.trim().split(/\s+/))
          .filter((tokens) => tokens[0])
          .map(([directive, ...sources]) => [directive, sources]),
      );
      for (const directive of ["default-src", "script-src", "connect-src", "worker-src"]) {
        const sources = directives.get(directive) ?? [];
        expect(sources, `${name} ${directive}`).not.toContain("*");
        expect(sources, `${name} ${directive}`).not.toContain("'unsafe-eval'");
        expect(sources, `${name} ${directive}`).not.toContain("http:");
        expect(sources, `${name} ${directive}`).not.toContain("https:");
      }
      expect(directives.get("script-src"), `${name} script-src`).not.toContain("'unsafe-inline'");
      expect(directives.get("object-src"), `${name} object-src`).toEqual(["'none'"]);
    }
  });

  it("does not register the shell plugin", () => {
    const cargoToml = fs.readFileSync(path.join(tauriDir, "Cargo.toml"), "utf8");
    const mainRs = fs.readFileSync(path.join(tauriDir, "src/main.rs"), "utf8");
    const packageJson = readJson<{ dependencies?: Record<string, string> }>(
      path.join(repoRoot, "package.json"),
    );

    expect(cargoToml).not.toMatch(/^tauri-plugin-shell\s*=/m);
    expect(mainRs).not.toContain("tauri_plugin_shell");
    expect(packageJson.dependencies).not.toHaveProperty("@tauri-apps/plugin-shell");
  });
});
