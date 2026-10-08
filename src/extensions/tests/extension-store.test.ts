// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/auth/services/auth-api";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { PLATFORM_ARCH } from "@/utils/platform";
import { installedLanguages } from "../installer/installed-languages";
import { languageProviderRegistry } from "../languages/language-provider-registry";
import { extensionRegistry } from "../registry/extension-registry";
import { initializeExtensionStore, useExtensionStore } from "../registry/extension-store";
import type { AvailableExtension } from "../registry/extension-store-types";
import { themeRegistry } from "../themes/theme-registry";
import type { ExtensionManifest } from "../types/extension-manifest";

interface BackendExtension {
  id: string;
  name: string;
  version: string;
  installed_at: string;
  enabled: boolean;
}

const mocks = vi.hoisted(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve([]),
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };

  return {
    invoke: vi.fn(),
    listen: vi.fn(),
    packagedLanguages: [] as ExtensionManifest[],
    marketplace: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/event")>()),
  listen: mocks.listen,
}));

vi.mock("../languages/language-packager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../languages/language-packager")>()),
  initializeLanguagePackager: vi.fn().mockResolvedValue(undefined),
  getPackagedLanguageExtensions: () => mocks.packagedLanguages,
  getLanguageExtensionById: (languageId: string) =>
    mocks.packagedLanguages.find((manifest) =>
      manifest.languages?.some((language) => language.id === languageId),
    ),
}));

vi.mock("../marketplace/marketplace-extensions", () => ({
  loadMarketplaceContributionExtensions: mocks.marketplace,
}));

vi.mock("@/features/telemetry/services/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/telemetry/services/telemetry")>()),
  recordExtensionLifecycleTelemetry: vi.fn().mockResolvedValue(undefined),
  recordExtensionRegistrySync: vi.fn().mockResolvedValue(undefined),
  recordExtensionUpdateCheck: vi.fn().mockResolvedValue(undefined),
}));

enableMapSet();

const LANGUAGE_ID = "testlang";
const LANGUAGE_EXTENSION_ID = "test.lang";
const SERVER_LANGUAGE_ID = "serverlang";
const SERVER_EXTENSION_ID = "test.server-lang";
const THEME_EXTENSION_ID = "test.theme-pack";
const THEME_ID = "test-theme-pack-dark";

const languageManifest: ExtensionManifest = {
  id: LANGUAGE_EXTENSION_ID,
  name: "Test Lang",
  displayName: "Test Lang",
  description: "Language integration",
  version: "1.0.0",
  publisher: "Athas",
  categories: ["Language"],
  languages: [{ id: LANGUAGE_ID, extensions: [".tl"], aliases: ["TL"] }],
  installation: {
    downloadUrl: "https://example.com/test-lang.tar.gz",
    size: 10,
    checksum: "abc",
  },
};

const serverLanguageManifest: ExtensionManifest = {
  ...languageManifest,
  id: SERVER_EXTENSION_ID,
  name: "Server Lang",
  displayName: "Server Lang",
  languages: [{ id: SERVER_LANGUAGE_ID, extensions: [".sl"] }],
  lsp: {
    fileExtensions: [".sl"],
    languageIds: [SERVER_LANGUAGE_ID],
    name: "server-ls",
    runtime: "node",
    package: "server-ls",
    server: { default: "server-ls" },
  },
};

const themeManifest: ExtensionManifest = {
  id: THEME_EXTENSION_ID,
  name: "Theme Pack",
  displayName: "Theme Pack",
  description: "Color themes",
  version: "2.0.0",
  publisher: "Athas",
  categories: ["Theme"],
  themes: [{ id: THEME_ID, name: "Theme Pack Dark", appearance: "dark", colors: {} }],
  installation: {
    downloadUrl: "https://packages.example.com/theme-pack.tar.gz",
    size: 2048,
    checksum: "sha256-theme",
  },
};

const backend = {
  installed: [] as BackendExtension[],
  toolPaths: new Map<string, string>(),
  failedTools: new Map<string, string>(),
  installError: null as Error | null,
  uninstallError: null as Error | null,
  installRequests: [] as Array<{
    extensionId: string;
    url: string;
    checksum: string;
    size: number;
  }>,
};

function routeInvoke(command: string, args: Record<string, unknown> = {}) {
  switch (command) {
    case "list_installed_extensions":
      return backend.installed;
    case "install_extension": {
      const request = args as (typeof backend.installRequests)[number];
      backend.installRequests.push(request);
      if (backend.installError) throw backend.installError;
      backend.installed.push({
        id: request.extensionId,
        name: request.extensionId,
        version: "2.0.0",
        installed_at: "2026-01-01T00:00:00.000Z",
        enabled: true,
      });
      return null;
    }
    case "uninstall_extension":
      if (backend.uninstallError) throw backend.uninstallError;
      backend.installed = backend.installed.filter((ext) => ext.id !== args.extensionId);
      return null;
    case "install_language_tools": {
      const languageId = String(args.languageId);
      const status: Record<string, unknown> = { languageId };
      for (const tool of ["lsp", "formatter", "linter"]) {
        const failure = backend.failedTools.get(`${languageId}:${tool}`);
        status[tool] = failure ? { failed: failure } : null;
      }
      return status;
    }
    case "get_tool_path":
      return backend.toolPaths.get(`${args.languageId}:${args.toolType}`) ?? null;
    case "get_bundled_extensions_path":
      return "/bundled";
    default:
      return null;
  }
}

function setEnterpriseAllowlist(allowedExtensionIds: string[]) {
  useAuthStore.setState({
    subscription: {
      status: "pro",
      subscription: null,
      enterprise: {
        has_access: true,
        policy: {
          managedMode: true,
          requireExtensionAllowlist: true,
          allowedExtensionIds,
        },
      },
    } as unknown as SubscriptionInfo,
  });
}

function getAvailable(extensionId: string): AvailableExtension | undefined {
  return useExtensionStore.getState().availableExtensions.get(extensionId);
}

function storeActions() {
  return useExtensionStore.getState().actions;
}

async function loadCatalog(manifests: {
  languages?: ExtensionManifest[];
  marketplace?: ExtensionManifest[];
}) {
  mocks.packagedLanguages = manifests.languages ?? [];
  mocks.marketplace.mockResolvedValue(manifests.marketplace ?? []);
  await storeActions().loadAvailableExtensions();
}

function readInstalledLanguageIds() {
  return JSON.parse(localStorage.getItem("athas.installedLanguages") ?? "[]").map(
    (entry: { languageId: string }) => entry.languageId,
  );
}

function readDisabledExtensionIds() {
  return JSON.parse(localStorage.getItem("athas.disabledExtensions") ?? "[]");
}

const testExtensionIds = [LANGUAGE_EXTENSION_ID, SERVER_EXTENSION_ID, THEME_EXTENSION_ID];

beforeEach(() => {
  localStorage.clear();
  backend.installed = [];
  backend.toolPaths.clear();
  backend.failedTools.clear();
  backend.installError = null;
  backend.uninstallError = null;
  backend.installRequests = [];
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) =>
    routeInvoke(command, args),
  );
  mocks.packagedLanguages = [];
  mocks.marketplace.mockResolvedValue([]);
  useAuthStore.setState({ subscription: null });
  useExtensionStore.setState({
    availableExtensions: new Map(),
    installedExtensions: new Map(),
    extensionsWithUpdates: new Set(),
    isLoadingRegistry: false,
    isLoadingInstalled: false,
    isCheckingUpdates: false,
  });
});

afterEach(async () => {
  for (const extensionId of testExtensionIds) {
    extensionRegistry.unregisterExtension(extensionId);
    languageProviderRegistry.unregister(extensionId);
  }
  languageProviderRegistry.unregister(`${LANGUAGE_EXTENSION_ID}:${LANGUAGE_ID}`);
  languageProviderRegistry.unregister(`${SERVER_EXTENSION_ID}:${SERVER_LANGUAGE_ID}`);
  themeRegistry.unregisterThemesByExtension(THEME_EXTENSION_ID);
  const { deactivateExtensionContributions } =
    await import("../runtime/extension-contribution-runtime");
  await deactivateExtensionContributions(THEME_EXTENSION_ID, themeManifest);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("extension store catalog loading", () => {
  it("lists languages, built-in databases, and marketplace integrations as installable", async () => {
    await loadCatalog({ languages: [languageManifest], marketplace: [themeManifest] });

    const state = useExtensionStore.getState();
    expect(state.isLoadingRegistry).toBe(false);
    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isEnabled: false,
      isInstalling: false,
      runtimeIssues: [],
    });
    expect(getAvailable(THEME_EXTENSION_ID)?.isInstalled).toBe(false);
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)?.state).toBe("not-installed");

    const sqlite = Array.from(state.availableExtensions.values()).find((ext) =>
      ext.manifest.databases?.some((provider) => provider.id === "sqlite"),
    );
    expect(sqlite).toMatchObject({ isInstalled: true, isEnabled: true });
    expect(storeActions().isExtensionInstalled(sqlite!.manifest.id)).toBe(true);
    expect(extensionRegistry.getExtension(sqlite!.manifest.id)).toMatchObject({
      isBundled: true,
      state: "installed",
    });
  });

  it("drops retired integrations and keeps the last manifest for duplicate ids", async () => {
    const retired = { ...themeManifest, id: "athas.theme.market" };
    const newerLanguage = { ...languageManifest, version: "1.5.0" };

    await loadCatalog({ languages: [languageManifest, retired], marketplace: [newerLanguage] });

    expect(getAvailable("athas.theme.market")).toBeUndefined();
    expect(getAvailable(LANGUAGE_EXTENSION_ID)?.manifest.version).toBe("1.5.0");
  });

  it("reflects installed and disabled state already known to the store", async () => {
    useExtensionStore.setState({
      installedExtensions: new Map([
        [
          LANGUAGE_EXTENSION_ID,
          {
            id: LANGUAGE_EXTENSION_ID,
            name: "Test Lang",
            version: "1.0.0",
            installed_at: "2026-01-01T00:00:00.000Z",
            enabled: false,
          },
        ],
      ]),
    });

    await loadCatalog({ languages: [languageManifest] });

    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: false,
    });
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)).toMatchObject({
      state: "deactivated",
      isEnabled: false,
    });
  });

  it("does not downgrade an extension the registry already has installed", async () => {
    extensionRegistry.registerExtension(
      { ...languageManifest, version: "9.9.9" },
      { path: "/runtime/test-lang", state: "installed" },
    );

    await loadCatalog({ languages: [languageManifest] });

    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)).toMatchObject({
      path: "/runtime/test-lang",
      state: "installed",
    });
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)?.manifest.version).toBe("9.9.9");
  });

  it("clears the loading flag when the catalog fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.marketplace.mockRejectedValue(new Error("offline"));

    await storeActions().loadAvailableExtensions();

    expect(useExtensionStore.getState().isLoadingRegistry).toBe(false);
    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toBeUndefined();
  });

  it("finds the available extension that handles a file", async () => {
    await loadCatalog({ languages: [languageManifest] });

    expect(storeActions().getExtensionForFile("/repo/main.tl")?.manifest.id).toBe(
      LANGUAGE_EXTENSION_ID,
    );
    expect(storeActions().getExtensionForFile("/repo/main.unknown")).toBeUndefined();
  });
});

describe("extension store installed state", () => {
  it("merges backend installs and installed languages, honoring disabled extensions", async () => {
    await loadCatalog({ languages: [languageManifest], marketplace: [themeManifest] });
    backend.installed = [
      {
        id: THEME_EXTENSION_ID,
        name: "Theme Pack",
        version: "2.0.0",
        installed_at: "2026-01-01T00:00:00.000Z",
        enabled: true,
      },
    ];
    await installedLanguages.add({
      languageId: LANGUAGE_ID,
      extensionId: LANGUAGE_EXTENSION_ID,
      version: "1.0.0",
    });
    localStorage.setItem("athas.disabledExtensions", JSON.stringify([THEME_EXTENSION_ID]));

    await storeActions().loadInstalledExtensions();

    const state = useExtensionStore.getState();
    expect(state.isLoadingInstalled).toBe(false);
    expect(Array.from(state.installedExtensions.keys()).sort()).toEqual([
      LANGUAGE_EXTENSION_ID,
      THEME_EXTENSION_ID,
    ]);
    expect(state.installedExtensions.get(THEME_EXTENSION_ID)?.enabled).toBe(false);
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({ isInstalled: true, isEnabled: false });
    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: true,
      runtimeIssues: [],
    });
    expect(storeActions().isExtensionInstalled(LANGUAGE_EXTENSION_ID)).toBe(true);
    expect(languageProviderRegistry.get(LANGUAGE_ID)?.id).toBe(LANGUAGE_ID);
  });

  it("surfaces missing language tools as runtime issues", async () => {
    await loadCatalog({ languages: [serverLanguageManifest] });
    await installedLanguages.add({
      languageId: SERVER_LANGUAGE_ID,
      extensionId: SERVER_EXTENSION_ID,
      version: "1.0.0",
    });
    backend.failedTools.set(`${SERVER_LANGUAGE_ID}:lsp`, "npm install failed");

    await storeActions().loadInstalledExtensions();

    expect(getAvailable(SERVER_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      runtimeIssues: [{ tool: "lsp", message: "npm install failed" }],
    });
  });

  it("marks extensions missing from the backend as not installed", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    useExtensionStore.setState((state) => {
      const ext = state.availableExtensions.get(THEME_EXTENSION_ID)!;
      return {
        availableExtensions: new Map(state.availableExtensions).set(THEME_EXTENSION_ID, {
          ...ext,
          isInstalled: true,
          isEnabled: true,
        }),
      };
    });

    await storeActions().loadInstalledExtensions();

    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isEnabled: false,
    });
    expect(storeActions().isExtensionInstalled(THEME_EXTENSION_ID)).toBe(false);
    expect(storeActions().isExtensionInstalled("test.unknown")).toBe(false);
  });

  it("clears the loading flag when installed languages cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(installedLanguages, "list").mockRejectedValue(new Error("storage unavailable"));

    await storeActions().loadInstalledExtensions();

    expect(useExtensionStore.getState().isLoadingInstalled).toBe(false);
    expect(useExtensionStore.getState().installedExtensions.size).toBe(0);
  });
});

describe("extension store install", () => {
  it("rejects extensions that are not in the catalog", async () => {
    await expect(storeActions().installExtension("test.unknown")).rejects.toThrow(
      "Integration test.unknown not found in registry",
    );
  });

  it("blocks installs outside the enterprise allowlist without touching state", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    setEnterpriseAllowlist(["athas.other"]);

    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toThrow(
      /blocked by enterprise policy/,
    );

    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isInstalling: false,
    });
    expect(backend.installRequests).toEqual([]);
  });

  it("allows installs on the enterprise allowlist regardless of id casing", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    setEnterpriseAllowlist([` ${THEME_EXTENSION_ID.toUpperCase()} `]);

    await storeActions().installExtension(THEME_EXTENSION_ID);

    expect(getAvailable(THEME_EXTENSION_ID)?.isInstalled).toBe(true);
  });

  it("rejects extensions without installation metadata", async () => {
    await loadCatalog({ marketplace: [{ ...themeManifest, installation: undefined }] });

    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toThrow(
      `Integration ${THEME_EXTENSION_ID} has no installation metadata`,
    );
    expect(getAvailable(THEME_EXTENSION_ID)?.isInstalling).toBe(false);
  });

  it("installs a language extension and registers its language at runtime", async () => {
    await loadCatalog({ languages: [languageManifest] });

    await storeActions().installExtension(LANGUAGE_EXTENSION_ID);

    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: true,
      isInstalling: false,
      installProgress: 100,
      installError: undefined,
      runtimeIssues: [],
    });
    expect(
      useExtensionStore.getState().installedExtensions.get(LANGUAGE_EXTENSION_ID),
    ).toMatchObject({
      id: LANGUAGE_EXTENSION_ID,
      name: "Test Lang",
      version: "1.0.0",
      enabled: true,
    });
    expect(readInstalledLanguageIds()).toEqual([LANGUAGE_ID]);
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)?.state).toBe("installed");
    expect(languageProviderRegistry.get(".tl")?.id).toBe(LANGUAGE_ID);
    expect(backend.installRequests).toEqual([]);
  });

  it("rewrites the language server command to the resolved tool path", async () => {
    await loadCatalog({ languages: [serverLanguageManifest] });
    backend.toolPaths.set(`${SERVER_LANGUAGE_ID}:lsp`, "/tools/server-ls");

    await storeActions().installExtension(SERVER_EXTENSION_ID);

    expect(getAvailable(SERVER_EXTENSION_ID)?.manifest.lsp?.server).toEqual({
      default: "/tools/server-ls",
    });
    expect(extensionRegistry.getLspServerPath("/repo/main.sl")).toBe("/tools/server-ls");
  });

  it("fails the install when the language server cannot be installed", async () => {
    await loadCatalog({ languages: [serverLanguageManifest] });
    backend.failedTools.set(`${SERVER_LANGUAGE_ID}:lsp`, "npm install failed");

    await expect(storeActions().installExtension(SERVER_EXTENSION_ID)).rejects.toThrow(
      "npm install failed",
    );

    expect(getAvailable(SERVER_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isInstalling: false,
      installError: "npm install failed",
      runtimeIssues: [],
    });
    expect(useExtensionStore.getState().installedExtensions.has(SERVER_EXTENSION_ID)).toBe(false);
    expect(extensionRegistry.getExtension(SERVER_EXTENSION_ID)?.state).toBe("not-installed");
  });

  it("installs a downloadable package with its checksum and activates its contributions", async () => {
    await loadCatalog({ marketplace: [themeManifest] });

    await storeActions().installExtension(THEME_EXTENSION_ID);

    expect(backend.installRequests).toEqual([
      {
        extensionId: THEME_EXTENSION_ID,
        url: "https://packages.example.com/theme-pack.tar.gz",
        checksum: "sha256-theme",
        size: 2048,
      },
    ]);
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: true,
      isInstalling: false,
      installProgress: 100,
    });
    expect(useExtensionStore.getState().installedExtensions.get(THEME_EXTENSION_ID)?.enabled).toBe(
      true,
    );
    expect(themeRegistry.getThemeSource(THEME_ID)?.extensionId).toBe(THEME_EXTENSION_ID);
  });

  it("prefers the package built for the current platform", async () => {
    await loadCatalog({
      marketplace: [
        {
          ...themeManifest,
          installation: {
            ...themeManifest.installation,
            platformArch: {
              [PLATFORM_ARCH]: {
                downloadUrl: "https://packages.example.com/theme-pack-native.tar.gz",
                size: 4096,
                checksum: "sha256-native",
              },
            },
          },
        },
      ],
    });

    await storeActions().installExtension(THEME_EXTENSION_ID);

    expect(backend.installRequests[0]).toMatchObject({
      url: "https://packages.example.com/theme-pack-native.tar.gz",
      checksum: "sha256-native",
      size: 4096,
    });
  });

  it("refuses to install when no package matches the current platform", async () => {
    const otherArch = PLATFORM_ARCH === "linux-x64" ? "darwin-arm64" : "linux-x64";
    await loadCatalog({
      marketplace: [
        {
          ...themeManifest,
          installation: {
            platformArch: {
              [otherArch]: {
                downloadUrl: "https://packages.example.com/theme-pack-other.tar.gz",
                size: 4096,
                checksum: "sha256-other",
              },
            },
          },
        },
      ],
    });

    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toThrow(
      `No compatible package for Theme Pack on ${PLATFORM_ARCH}`,
    );
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalling: false,
      isInstalled: false,
      installError: `No compatible package for Theme Pack on ${PLATFORM_ARCH}`,
    });
    expect(backend.installRequests).toEqual([]);
  });

  it("refuses to install packages without a checksum", async () => {
    await loadCatalog({
      marketplace: [
        {
          ...themeManifest,
          installation: { downloadUrl: themeManifest.installation!.downloadUrl, size: 2048 },
        },
      ],
    });

    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toThrow(
      /No compatible package/,
    );
    expect(backend.installRequests).toEqual([]);
  });

  it("records the backend error and leaves the extension uninstalled when download fails", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    backend.installError = new Error("Checksum mismatch");

    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toThrow(
      "Checksum mismatch",
    );

    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isInstalling: false,
      installError: "Checksum mismatch",
    });
    expect(useExtensionStore.getState().installedExtensions.has(THEME_EXTENSION_ID)).toBe(false);
    expect(themeRegistry.getTheme(THEME_ID)).toBeUndefined();
  });

  it("stringifies non-Error install failures", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "install_extension") throw "disk full";
      return routeInvoke(command, args);
    });

    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toBe("disk full");
    expect(getAvailable(THEME_EXTENSION_ID)?.installError).toBe("disk full");
  });

  it("clears a previous install error when retrying", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    backend.installError = new Error("Network unreachable");
    await expect(storeActions().installExtension(THEME_EXTENSION_ID)).rejects.toThrow();

    backend.installError = null;
    await storeActions().installExtension(THEME_EXTENSION_ID);

    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      installError: undefined,
    });
  });
});

describe("extension store uninstall", () => {
  it("rejects extensions that are not in the catalog", async () => {
    await expect(storeActions().uninstallExtension("test.unknown")).rejects.toThrow(
      "Integration test.unknown not found",
    );
  });

  it("removes a language extension and its runtime registrations", async () => {
    await loadCatalog({ languages: [languageManifest] });
    await storeActions().installExtension(LANGUAGE_EXTENSION_ID);

    await storeActions().uninstallExtension(LANGUAGE_EXTENSION_ID);

    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isEnabled: false,
      runtimeIssues: [],
    });
    expect(useExtensionStore.getState().installedExtensions.has(LANGUAGE_EXTENSION_ID)).toBe(false);
    expect(readInstalledLanguageIds()).toEqual([]);
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)?.state).toBe("not-installed");
    expect(languageProviderRegistry.get(".tl")).toBeUndefined();
  });

  it("removes a downloaded package and its contributions", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    await storeActions().installExtension(THEME_EXTENSION_ID);

    await storeActions().uninstallExtension(THEME_EXTENSION_ID);

    expect(backend.installed).toEqual([]);
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      isInstalled: false,
      isEnabled: false,
    });
    expect(useExtensionStore.getState().installedExtensions.has(THEME_EXTENSION_ID)).toBe(false);
    expect(themeRegistry.getTheme(THEME_ID)).toBeUndefined();
  });

  it("keeps the extension installed when the backend cannot remove it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await loadCatalog({ marketplace: [themeManifest] });
    await storeActions().installExtension(THEME_EXTENSION_ID);
    backend.uninstallError = new Error("Permission denied");

    await expect(storeActions().uninstallExtension(THEME_EXTENSION_ID)).rejects.toThrow(
      "Permission denied",
    );

    expect(getAvailable(THEME_EXTENSION_ID)?.isInstalled).toBe(true);
    expect(useExtensionStore.getState().installedExtensions.has(THEME_EXTENSION_ID)).toBe(true);
  });
});

describe("extension store enable and disable", () => {
  it("rejects unknown and uninstalled extensions", async () => {
    await loadCatalog({ languages: [languageManifest] });

    await expect(storeActions().enableExtension("test.unknown")).rejects.toThrow(
      "Integration test.unknown not found",
    );
    await expect(storeActions().disableExtension("test.unknown")).rejects.toThrow(
      "Integration test.unknown not found",
    );
    await expect(storeActions().enableExtension(LANGUAGE_EXTENSION_ID)).rejects.toThrow(
      `Integration ${LANGUAGE_EXTENSION_ID} is not installed`,
    );
    await expect(storeActions().disableExtension(LANGUAGE_EXTENSION_ID)).rejects.toThrow(
      `Integration ${LANGUAGE_EXTENSION_ID} is not installed`,
    );
  });

  it("disables and re-enables a language extension, persisting the choice", async () => {
    await loadCatalog({ languages: [languageManifest] });
    await storeActions().installExtension(LANGUAGE_EXTENSION_ID);

    await storeActions().disableExtension(LANGUAGE_EXTENSION_ID);

    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: false,
    });
    expect(
      useExtensionStore.getState().installedExtensions.get(LANGUAGE_EXTENSION_ID)?.enabled,
    ).toBe(false);
    expect(readDisabledExtensionIds()).toEqual([LANGUAGE_EXTENSION_ID]);
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)).toMatchObject({
      state: "deactivated",
      isEnabled: false,
    });
    expect(languageProviderRegistry.get(".tl")).toBeUndefined();

    await storeActions().enableExtension(LANGUAGE_EXTENSION_ID);

    expect(getAvailable(LANGUAGE_EXTENSION_ID)?.isEnabled).toBe(true);
    expect(
      useExtensionStore.getState().installedExtensions.get(LANGUAGE_EXTENSION_ID)?.enabled,
    ).toBe(true);
    expect(readDisabledExtensionIds()).toEqual([]);
    expect(extensionRegistry.getExtension(LANGUAGE_EXTENSION_ID)).toMatchObject({
      state: "installed",
      isEnabled: true,
    });
    expect(languageProviderRegistry.get(".tl")?.id).toBe(LANGUAGE_ID);
  });

  it("keeps a disabled language inactive across a reload of installed extensions", async () => {
    await loadCatalog({ languages: [languageManifest] });
    await storeActions().installExtension(LANGUAGE_EXTENSION_ID);
    await storeActions().disableExtension(LANGUAGE_EXTENSION_ID);

    await storeActions().loadInstalledExtensions();

    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: false,
    });
    expect(languageProviderRegistry.get(".tl")).toBeUndefined();
  });

  it("removes and restores contributions of a downloaded extension", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    await storeActions().installExtension(THEME_EXTENSION_ID);

    await storeActions().disableExtension(THEME_EXTENSION_ID);

    expect(themeRegistry.getTheme(THEME_ID)).toBeUndefined();
    expect(getAvailable(THEME_EXTENSION_ID)?.isEnabled).toBe(false);
    expect(extensionRegistry.getExtension(THEME_EXTENSION_ID)?.state).toBe("deactivated");

    await storeActions().enableExtension(THEME_EXTENSION_ID);

    expect(themeRegistry.getThemeSource(THEME_ID)?.extensionId).toBe(THEME_EXTENSION_ID);
    expect(getAvailable(THEME_EXTENSION_ID)?.isEnabled).toBe(true);
    expect(extensionRegistry.getExtension(THEME_EXTENSION_ID)?.state).toBe("installed");
  });
});

describe("extension store install progress", () => {
  it("tracks progress and stops installing when an error is reported", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    useExtensionStore.setState((state) => ({
      availableExtensions: new Map(state.availableExtensions).set(THEME_EXTENSION_ID, {
        ...state.availableExtensions.get(THEME_EXTENSION_ID)!,
        isInstalling: true,
      }),
    }));

    storeActions().updateInstallProgress(THEME_EXTENSION_ID, 40);
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      installProgress: 40,
      isInstalling: true,
    });

    storeActions().updateInstallProgress(THEME_EXTENSION_ID, 55, "Download interrupted");
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      installProgress: 55,
      isInstalling: false,
      installError: "Download interrupted",
    });

    storeActions().updateInstallProgress("test.unknown", 10);
    expect(getAvailable("test.unknown")).toBeUndefined();
  });
});

describe("extension store updates", () => {
  it("reports installed languages whose catalog version differs", async () => {
    await loadCatalog({
      languages: [
        { ...languageManifest, version: "1.1.0" },
        { ...serverLanguageManifest, version: "1.0.0" },
      ],
    });
    await installedLanguages.add({
      languageId: LANGUAGE_ID,
      extensionId: LANGUAGE_EXTENSION_ID,
      version: "1.0.0",
    });
    await installedLanguages.add({ languageId: SERVER_LANGUAGE_ID, version: "1.0.0" });
    await installedLanguages.add({ languageId: "orphan", version: "0.1.0" });

    const updates = await storeActions().checkForUpdates();

    expect(updates).toEqual([LANGUAGE_EXTENSION_ID]);
    expect(Array.from(useExtensionStore.getState().extensionsWithUpdates)).toEqual([
      LANGUAGE_EXTENSION_ID,
    ]);
    expect(useExtensionStore.getState().isCheckingUpdates).toBe(false);
  });

  it("returns no updates when installed languages cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(installedLanguages, "list").mockRejectedValue(new Error("storage unavailable"));

    await expect(storeActions().checkForUpdates()).resolves.toEqual([]);
    expect(useExtensionStore.getState().isCheckingUpdates).toBe(false);
  });

  it("rejects updates for unknown or policy-blocked extensions", async () => {
    await loadCatalog({ languages: [languageManifest] });

    await expect(storeActions().updateExtension("test.unknown")).rejects.toThrow(
      "Integration test.unknown not found",
    );

    setEnterpriseAllowlist([]);
    await expect(storeActions().updateExtension(LANGUAGE_EXTENSION_ID)).rejects.toThrow(
      /Update blocked by enterprise policy/,
    );
  });

  it("reinstalls a language extension at the catalog version", async () => {
    await loadCatalog({ languages: [languageManifest] });
    await storeActions().installExtension(LANGUAGE_EXTENSION_ID);
    await loadCatalog({ languages: [{ ...languageManifest, version: "1.1.0" }] });
    await storeActions().checkForUpdates();
    expect(useExtensionStore.getState().extensionsWithUpdates.has(LANGUAGE_EXTENSION_ID)).toBe(
      true,
    );

    await storeActions().updateExtension(LANGUAGE_EXTENSION_ID);

    expect(useExtensionStore.getState().extensionsWithUpdates.has(LANGUAGE_EXTENSION_ID)).toBe(
      false,
    );
    expect(
      useExtensionStore.getState().installedExtensions.get(LANGUAGE_EXTENSION_ID)?.version,
    ).toBe("1.1.0");
    expect(getAvailable(LANGUAGE_EXTENSION_ID)).toMatchObject({
      isInstalled: true,
      isEnabled: true,
    });
    const installed = await installedLanguages.list();
    expect(installed.map((entry) => [entry.languageId, entry.version])).toEqual([
      [LANGUAGE_ID, "1.1.0"],
    ]);
    await expect(storeActions().checkForUpdates()).resolves.toEqual([]);
  });

  it("reinstalls a downloaded extension package", async () => {
    await loadCatalog({ marketplace: [themeManifest] });
    await storeActions().installExtension(THEME_EXTENSION_ID);

    await storeActions().updateExtension(THEME_EXTENSION_ID);

    expect(backend.installRequests).toHaveLength(2);
    expect(getAvailable(THEME_EXTENSION_ID)?.isInstalled).toBe(true);
    expect(themeRegistry.getThemeSource(THEME_ID)?.extensionId).toBe(THEME_EXTENSION_ID);
  });
});

describe("extension store initialization", () => {
  it("loads the catalog, applies backend progress events, and schedules update checks", async () => {
    vi.useFakeTimers();
    let progressHandler: ((event: { payload: unknown }) => void) | undefined;
    mocks.listen.mockImplementation(async (eventName: string, handler: typeof progressHandler) => {
      if (eventName === "extension://install-progress") progressHandler = handler;
      return () => undefined;
    });
    mocks.packagedLanguages = [{ ...languageManifest, version: "2.0.0" }];
    mocks.marketplace.mockResolvedValue([themeManifest]);
    await installedLanguages.add({
      languageId: LANGUAGE_ID,
      extensionId: LANGUAGE_EXTENSION_ID,
      version: "1.0.0",
    });

    await initializeExtensionStore();

    expect(getAvailable(LANGUAGE_EXTENSION_ID)?.isInstalled).toBe(true);
    expect(getAvailable(THEME_EXTENSION_ID)?.isInstalled).toBe(false);

    progressHandler?.({
      payload: {
        extension_id: THEME_EXTENSION_ID,
        status: { type: "downloading" },
        progress: 0.25,
        message: "",
      },
    });
    expect(getAvailable(THEME_EXTENSION_ID)?.installProgress).toBe(25);

    progressHandler?.({
      payload: {
        extension_id: THEME_EXTENSION_ID,
        status: { type: "failed", error: "Checksum mismatch" },
        progress: 0.5,
        message: "",
      },
    });
    expect(getAvailable(THEME_EXTENSION_ID)).toMatchObject({
      installProgress: 50,
      installError: "Checksum mismatch",
      isInstalling: false,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(useExtensionStore.getState().extensionsWithUpdates.has(LANGUAGE_EXTENSION_ID)).toBe(
      true,
    );

    await expect(initializeExtensionStore()).resolves.toBeUndefined();
    expect(mocks.listen).toHaveBeenCalledTimes(1);
  });
});
