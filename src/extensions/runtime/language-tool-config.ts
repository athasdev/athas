import { NODE_PLATFORM, PLATFORM_ARCH } from "@/utils/platform";
import type { ExtensionManifest, ToolRuntime } from "../types/extension-manifest";

export type LanguageToolType = "lsp" | "formatter" | "linter";

type BackendToolRuntime = Extract<
  ToolRuntime,
  "bun" | "node" | "python" | "go" | "rust" | "ruby" | "r" | "system" | "binary"
>;

interface BackendToolConfig {
  name: string;
  command?: string;
  runtime: BackendToolRuntime;
  package?: string;
  packages?: string[];
  downloadUrl?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface BackendLanguageToolConfigSet {
  lsp?: BackendToolConfig;
  formatter?: BackendToolConfig;
  linter?: BackendToolConfig;
}

const MARKSMAN_LATEST_RELEASE_BASE =
  "https://github.com/artempyanykh/marksman/releases/latest/download";
const STYLUA_LATEST_RELEASE_BASE =
  "https://github.com/JohnnyMorganz/StyLua/releases/latest/download";
const LUA_LANGUAGE_SERVER_VERSION = "3.18.2";
const LUA_LANGUAGE_SERVER_RELEASE_BASE =
  "https://github.com/LuaLS/lua-language-server/releases/download";
const ZIG_VERSION = "0.16.0";

function getCommandDefault(
  command:
    | {
        default?: string;
        darwin?: string;
        linux?: string;
        win32?: string;
      }
    | undefined,
): string | undefined {
  return command?.default || command?.darwin || command?.linux || command?.win32;
}

function getArchToken(): "arm64" | "x64" {
  return PLATFORM_ARCH.endsWith("arm64") ? "arm64" : "x64";
}

type TargetOsToken =
  | "apple-darwin"
  | "unknown-linux-gnu"
  | "unknown-linux-musl"
  | "pc-windows-msvc";

function getLinuxLibcToken(): "gnu" | "musl" | "unknown" {
  if (NODE_PLATFORM !== "linux") return "unknown";

  if (typeof process !== "undefined") {
    const override = process.env?.ATHAS_LINUX_LIBC?.toLowerCase();
    if (override === "musl" || override === "gnu" || override === "glibc") {
      return override === "musl" ? "musl" : "gnu";
    }

    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (report?.header && "glibcVersionRuntime" in report.header) {
      return "gnu";
    }
  }

  return "unknown";
}

function getTargetOsToken(): TargetOsToken {
  if (NODE_PLATFORM === "darwin") return "apple-darwin";
  if (NODE_PLATFORM === "win32") return "pc-windows-msvc";
  if (getLinuxLibcToken() === "musl") return "unknown-linux-musl";
  return "unknown-linux-gnu";
}

function getTargetArchToken(): "aarch64" | "x86_64" {
  return getArchToken() === "arm64" ? "aarch64" : "x86_64";
}

function resolveDownloadUrlTemplate(template: string, extensionVersion: string): string {
  return template
    .replace(/\$\{os\}/g, NODE_PLATFORM)
    .replace(/\$\{arch\}/g, getArchToken())
    .replace(/\$\{platformArch\}/g, PLATFORM_ARCH)
    .replace(/\$\{targetOs\}/g, getTargetOsToken())
    .replace(/\$\{targetArch\}/g, getTargetArchToken())
    .replace(/\$\{archiveExt\}/g, NODE_PLATFORM === "win32" ? "zip" : "gz")
    .replace(/\$\{version\}/g, extensionVersion || "latest");
}

function getKnownToolDownloadUrl(name: string): string | undefined {
  if (name === "marksman") {
    if (NODE_PLATFORM === "darwin") {
      return `${MARKSMAN_LATEST_RELEASE_BASE}/marksman-macos`;
    }
    if (NODE_PLATFORM === "win32") {
      return `${MARKSMAN_LATEST_RELEASE_BASE}/marksman.exe`;
    }
    return `${MARKSMAN_LATEST_RELEASE_BASE}/marksman-linux-${getArchToken()}`;
  }

  if (name === "lua-language-server") {
    const platformArch =
      NODE_PLATFORM === "win32" ? "win32-x64" : `${NODE_PLATFORM}-${getArchToken()}`;
    const archiveExtension = NODE_PLATFORM === "win32" ? "zip" : "tar.gz";
    return `${LUA_LANGUAGE_SERVER_RELEASE_BASE}/${LUA_LANGUAGE_SERVER_VERSION}/lua-language-server-${LUA_LANGUAGE_SERVER_VERSION}-${platformArch}.${archiveExtension}`;
  }

  if (name === "stylua") {
    if (NODE_PLATFORM === "darwin") {
      return `${STYLUA_LATEST_RELEASE_BASE}/stylua-macos-${getTargetArchToken()}.zip`;
    }
    if (NODE_PLATFORM === "win32") {
      return `${STYLUA_LATEST_RELEASE_BASE}/stylua-windows-x86_64.zip`;
    }
    const libcSuffix =
      getLinuxLibcToken() === "musl" && getTargetArchToken() === "x86_64" ? "-musl" : "";
    return `${STYLUA_LATEST_RELEASE_BASE}/stylua-linux-${getTargetArchToken()}${libcSuffix}.zip`;
  }

  if (name === "zig") {
    const platform =
      NODE_PLATFORM === "darwin" ? "macos" : NODE_PLATFORM === "win32" ? "windows" : "linux";
    const archiveExtension = NODE_PLATFORM === "win32" ? "zip" : "tar.xz";
    return `https://ziglang.org/download/${ZIG_VERSION}/zig-${getTargetArchToken()}-${platform}-${ZIG_VERSION}.${archiveExtension}`;
  }

  return undefined;
}

export function resolveToolDownloadUrlForManifest(
  input: { name?: string; downloadUrl?: string },
  extensionVersion: string,
): string | undefined {
  const name = input.name?.trim();
  if (!name) return undefined;

  return (
    getKnownToolDownloadUrl(name) ||
    (input.downloadUrl
      ? resolveDownloadUrlTemplate(input.downloadUrl, extensionVersion)
      : undefined)
  );
}

export function resolveToolDownloadUrlForBackend(
  input: { name?: string; downloadUrl?: string },
  _extensionVersion: string,
): string | undefined {
  const name = input.name?.trim();
  if (!name) return undefined;

  return getKnownToolDownloadUrl(name) || input.downloadUrl;
}

export function resolveToolCommandForManifest(input: { name?: string }): string | undefined {
  return input.name?.trim() === "pyright" ? "pyright-langserver" : undefined;
}

function toBackendToolConfig(
  input: {
    name?: string;
    runtime?: ToolRuntime;
    package?: string;
    packages?: string[];
    downloadUrl?: string;
    args?: string[];
    env?: Record<string, string>;
  },
  extensionVersion: string,
): BackendToolConfig | undefined {
  const name = input.name?.trim();
  if (!name) return undefined;

  const downloadUrl = resolveToolDownloadUrlForBackend(input, extensionVersion);
  const command = resolveToolCommandForManifest(input);
  if (!input.runtime && !downloadUrl) return undefined;

  return {
    name,
    ...(command ? { command } : {}),
    runtime: input.runtime || "binary",
    ...(input.package ? { package: input.package } : {}),
    ...(input.packages ? { packages: input.packages } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(input.args ? { args: input.args } : {}),
    ...(input.env ? { env: input.env } : {}),
  };
}

export function getLanguageToolConfigSet(
  manifest?: ExtensionManifest,
): BackendLanguageToolConfigSet | undefined {
  if (!manifest) return undefined;

  const lsp = manifest.lsp
    ? toBackendToolConfig(
        {
          name: manifest.lsp.name || getCommandDefault(manifest.lsp.server),
          runtime: manifest.lsp.runtime,
          package: manifest.lsp.package,
          packages: manifest.lsp.packages,
          downloadUrl: manifest.lsp.downloadUrl,
          args: manifest.lsp.args,
          env: manifest.lsp.env,
        },
        manifest.version,
      )
    : undefined;
  const formatter = manifest.formatter
    ? toBackendToolConfig(
        {
          name: manifest.formatter.name || getCommandDefault(manifest.formatter.command),
          runtime: manifest.formatter.runtime,
          package: manifest.formatter.package,
          packages: manifest.formatter.packages,
          downloadUrl: manifest.formatter.downloadUrl,
          args: manifest.formatter.args,
          env: manifest.formatter.env,
        },
        manifest.version,
      )
    : undefined;
  const linter = manifest.linter
    ? toBackendToolConfig(
        {
          name: manifest.linter.name || getCommandDefault(manifest.linter.command),
          runtime: manifest.linter.runtime,
          package: manifest.linter.package,
          packages: manifest.linter.packages,
          downloadUrl: manifest.linter.downloadUrl,
          args: manifest.linter.args,
          env: manifest.linter.env,
        },
        manifest.version,
      )
    : undefined;
  const tools = {
    ...(lsp ? { lsp } : {}),
    ...(formatter ? { formatter } : {}),
    ...(linter ? { linter } : {}),
  };

  return Object.keys(tools).length > 0 ? tools : undefined;
}
