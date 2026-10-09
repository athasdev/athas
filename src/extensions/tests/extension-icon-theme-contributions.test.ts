// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { iconThemeRegistry } from "../icon-themes/icon-theme-registry";
import {
  activateExtensionContributions,
  deactivateExtensionContributions,
  isExtensionContributionActive,
} from "../runtime/extension-contribution-runtime";
import { themeRegistry } from "../themes/theme-registry";
import type { ExtensionManifest, IconThemeContribution } from "../types/extension-manifest";
import { uiExtensionHost } from "../ui/services/ui-extension-host";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      convertFileSrc: (path: string) => `asset://localhost${path}`,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const iconTheme: IconThemeContribution = {
  id: "acme-icons",
  name: "Acme Icons",
  description: "Icons for testing",
  preview: { fileName: "src", kind: "folder" },
  iconDefinitions: {
    file: "<svg>file</svg>",
    ts: "./icons/ts.svg",
    dts: "https://cdn.example/dts.svg",
    readme: "data:image/svg+xml,readme",
    folder: "./icons/folder.svg",
    folderOpen: "./icons/folder-open.svg",
    src: "./icons/src.svg",
    srcOpen: "./icons/src-open.svg",
    unknown: "icons/no-prefix.svg",
  },
  lightIconDefinitions: { file: "<svg>light file</svg>" },
  fileExtensions: { ts: "ts", ".d.ts": "dts", rs: "unknown" },
  filenames: { "README.md": "readme" },
  folders: { src: "src" },
  expandedFolders: { src: "srcOpen" },
  defaultFile: "file",
  defaultFolder: "folder",
  defaultFolderOpen: "folderOpen",
};

function manifest(id: string, overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id,
    name: id,
    displayName: id,
    description: "Contribution test",
    version: "1.0.0",
    publisher: "Acme",
    categories: ["Theme"],
    ...overrides,
  };
}

const settingWrites: Array<[string, unknown]> = [];
const activated: string[] = [];

beforeEach(() => {
  settingWrites.length = 0;
  vi.spyOn(useSettingsStore.getState().actions, "updateSetting").mockImplementation(
    async (key, value) => {
      settingWrites.push([key, value]);
    },
  );
  vi.spyOn(uiExtensionHost, "loadExtension").mockResolvedValue(undefined);
  vi.spyOn(uiExtensionHost, "unloadExtension").mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const id of activated.splice(0)) {
    await deactivateExtensionContributions(id, manifest(id));
  }
  vi.restoreAllMocks();
});

async function activate(id: string, overrides: Partial<ExtensionManifest>, path?: string) {
  activated.push(id);
  await activateExtensionContributions(id, manifest(id, overrides), path);
}

describe("icon theme contributions", () => {
  it("resolves file and folder icons from names, compound extensions and defaults", async () => {
    await activate("acme.icons", { iconThemes: [iconTheme] }, "/ext/acme");
    const theme = iconThemeRegistry.getTheme("acme-icons")!;

    expect(theme.preview).toEqual({ fileName: "src", isDirectory: true });
    expect(theme.getFileIcon("src/README.md", false)).toEqual({
      url: "data:image/svg+xml,readme",
    });
    expect(theme.getFileIcon("types.d.ts", false)).toEqual({ url: "https://cdn.example/dts.svg" });
    expect(theme.getFileIcon("main.TS", false)).toEqual({
      url: "asset://localhost/ext/acme/icons/ts.svg",
    });
    expect(theme.getFileIcon("main.rs", false)).toEqual({});
    expect(theme.getFileIcon(".gitignore", false).svg).toContain("file");
    expect(theme.getFileIcon("src", true)).toEqual({
      url: "asset://localhost/ext/acme/icons/src.svg",
    });
    expect(theme.getFileIcon("src", true, true)).toEqual({
      url: "asset://localhost/ext/acme/icons/src-open.svg",
    });
    expect(theme.getFileIcon("lib", true, true)).toEqual({
      url: "asset://localhost/ext/acme/icons/folder-open.svg",
    });
    expect(theme.getFileIcon("lib", true)).toEqual({
      url: "asset://localhost/ext/acme/icons/folder.svg",
    });
    expect(iconThemeRegistry.hasThemeFromExtension("acme.icons", "acme-icons")).toBe(true);
    expect(iconThemeRegistry.getThemesByExtension("acme.icons").map((item) => item.id)).toEqual([
      "acme-icons",
    ]);
  });

  it("switches to light icon definitions under a light color theme", async () => {
    await activate("acme.icons", { iconThemes: [iconTheme] }, "/ext/acme");
    themeRegistry.registerTheme({
      id: "acme-paper",
      name: "Paper",
      description: "",
      category: "Light",
      cssVariables: {},
      isDark: false,
    });
    themeRegistry.applyTheme("acme-paper");

    expect(iconThemeRegistry.getTheme("acme-icons")!.getFileIcon("notes", false)).toEqual({
      svg: "<svg>light file</svg>",
    });

    themeRegistry.unregisterTheme("acme-paper");
  });

  it("looks up the installed path for relative icons and tolerates a missing path", async () => {
    vi.spyOn(commands, "getExtensionPath")
      .mockResolvedValueOnce("/installed/acme")
      .mockRejectedValueOnce(new Error("not installed"));

    await activate("acme.icons", { iconThemes: [iconTheme] });
    expect(iconThemeRegistry.getTheme("acme-icons")!.getFileIcon("a.ts", false)).toEqual({
      url: "asset://localhost/installed/acme/icons/ts.svg",
    });

    await activate("acme.other-icons", {
      iconThemes: [{ ...iconTheme, id: "acme-other-icons" }],
    });
    expect(iconThemeRegistry.getTheme("acme-other-icons")!.getFileIcon("a.ts", false)).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(
      "Failed to resolve integration path for acme.other-icons:",
      expect.any(Error),
    );
  });
});

describe("contribution lifecycle", () => {
  it("rolls back registered themes when the extension entrypoint fails to load", async () => {
    vi.mocked(uiExtensionHost.loadExtension).mockRejectedValueOnce(new Error("worker crashed"));

    await expect(
      activateExtensionContributions(
        "acme.broken",
        manifest("acme.broken", {
          main: "dist/index.js",
          iconThemes: [{ ...iconTheme, id: "broken-icons", iconDefinitions: {} }],
          themes: [{ id: "broken-theme", name: "Broken", appearance: "dark", colors: {} }],
        }),
        "/ext/broken",
      ),
    ).rejects.toThrow("worker crashed");

    expect(themeRegistry.getTheme("broken-theme")).toBeUndefined();
    expect(iconThemeRegistry.getTheme("broken-icons")).toBeUndefined();
    expect(uiExtensionHost.unloadExtension).toHaveBeenCalledWith("acme.broken");
    expect(isExtensionContributionActive("acme.broken")).toBe(false);
  });

  it("falls back to default themes when the active ones are removed", async () => {
    const themes = [{ id: "acme-night", name: "Night", appearance: "dark" as const, colors: {} }];
    await activate("acme.night", { themes, iconThemes: [iconTheme] }, "/ext/acme");
    themeRegistry.applyTheme("acme-night");
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, iconTheme: "acme-icons" },
    }));

    await deactivateExtensionContributions(
      "acme.night",
      manifest("acme.night", { themes, iconThemes: [iconTheme] }),
    );
    activated.splice(activated.indexOf("acme.night"), 1);

    expect(settingWrites).toEqual([
      ["theme", "athas-dark"],
      ["iconTheme", "pierre-icons-complete"],
    ]);
    expect(themeRegistry.getTheme("acme-night")).toBeUndefined();
    expect(iconThemeRegistry.getTheme("acme-icons")).toBeUndefined();
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, iconTheme: "pierre-icons-complete" },
    }));
  });

  it("ignores retired extensions", async () => {
    await activateExtensionContributions(
      "athas.theme.market",
      manifest("athas.theme.market", {
        themes: [{ id: "market-theme", name: "Market", appearance: "dark", colors: {} }],
      }),
    );

    expect(themeRegistry.getTheme("market-theme")).toBeUndefined();
    expect(isExtensionContributionActive("athas.theme.market")).toBe(false);
  });
});

describe("icon theme registry", () => {
  it("marks bundled themes and notifies listeners until unsubscribed", () => {
    const changes: number[] = [];
    const stop = iconThemeRegistry.onRegistryChange(() =>
      changes.push(iconThemeRegistry.getVersion()),
    );
    const definition = {
      id: "plain-icons",
      name: "Plain",
      description: "",
      getFileIcon: () => ({}),
    };

    iconThemeRegistry.registerTheme(definition, { extensionId: "acme" });
    iconThemeRegistry.markBundledTheme("plain-icons");
    iconThemeRegistry.markBundledTheme("missing");
    expect(iconThemeRegistry.getThemeSource("plain-icons")).toEqual({
      extensionId: "builtin",
      isBundled: true,
    });

    iconThemeRegistry.registerTheme(definition);
    expect(iconThemeRegistry.getThemeSource("plain-icons")).toBeUndefined();
    iconThemeRegistry.clearExtension("nobody");
    stop();
    iconThemeRegistry.unregisterTheme("plain-icons");

    expect(changes).toHaveLength(3);
    expect(iconThemeRegistry.getTheme("plain-icons")).toBeUndefined();
  });
});
