import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function readRepoFile(filePath: string) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

describe("Linux release packaging", () => {
  it("uses an opaque native window instead of the macOS overlay configuration", () => {
    const config = JSON.parse(readRepoFile("src-tauri/tauri.linux.conf.json"));
    const [window] = config.app.windows;

    expect(window.create).toBe(false);
    expect(window.transparent).toBe(false);
    expect(window.decorations).toBe(true);
    expect(window.resizable).toBe(true);
    expect(window.preventOverflow).toBe(true);
    expect(window).not.toHaveProperty("titleBarStyle");
  });

  it("uses the app-owned CEF runtime style for Linux webviews", () => {
    const appSetup = readRepoFile("src-tauri/src/app_setup.rs");
    const windowCommands = readRepoFile("src-tauri/src/commands/ui/window.rs");
    const alloyRuntime = "browser_runtime_style(tauri_runtime_cef::RuntimeStyle::Alloy)";

    expect(appSetup).toContain(alloyRuntime);
    expect(windowCommands.split(alloyRuntime)).toHaveLength(3);
  });

  it("uses the XDG portal dialog backend without changing the CEF runtime", () => {
    const cargoManifest = readRepoFile("src-tauri/Cargo.toml");
    const dialogDependency = cargoManifest
      .split("\n")
      .find((line) => line.startsWith("tauri-plugin-dialog ="));
    const linuxFeature = cargoManifest.match(/linux = \[[\s\S]*?\n\]/)?.[0];

    expect(dialogDependency).toBeDefined();
    expect(dialogDependency).toContain('version = "2"');
    expect(dialogDependency).toContain("default-features = false");
    expect(dialogDependency).toContain('"xdg-portal"');
    expect(dialogDependency).not.toContain('"gtk3"');
    expect(linuxFeature).toContain('"tauri/cef"');
    expect(linuxFeature).toContain('"dep:tauri-runtime-cef"');
  });

  it("does not ship an unusable setuid helper in per-user tarballs", () => {
    const script = readRepoFile("scripts/release/packaging/linux/tarball.sh");
    const cefFiles = script.match(/cef_files=\(\n([\s\S]*?)\n\)/)?.[1];

    expect(cefFiles).toBeDefined();
    expect(cefFiles).not.toContain("chrome-sandbox");
  });

  it("preserves the root-owned setuid sandbox contract in Debian packages", () => {
    const script = readRepoFile("scripts/release/packaging/linux/native.sh");

    expect(script).toContain("chmod 4755");
    expect(script).toContain("dpkg-deb --root-owner-group");
  });

  it("declares the X11 keyboard runtime dependency in native packages", () => {
    const script = readRepoFile("scripts/release/packaging/linux/native.sh");
    const patchFunction = script.slice(script.indexOf("patch_deb_dependencies()"));

    expect(script).toContain('"libxkbcommon-x11-0",');
    expect(script).toContain('"libxkbcommon-x11",');
    expect(patchFunction).toContain("libxkbcommon-x11-0");
  });

  it("installs the portal file chooser and its fallback in native packages", () => {
    const script = readRepoFile("scripts/release/packaging/linux/native.sh");
    const debDependencies = script.match(/deb: \{\n\s+depends: \[([\s\S]*?)\n\s+\],/)?.[1];
    const rpmDependencies = script.match(/rpm: \{\n\s+depends: \[([\s\S]*?)\n\s+\],/)?.[1];
    const patchFunction = script.slice(script.indexOf("patch_deb_dependencies()"));

    for (const dependencies of [debDependencies, rpmDependencies]) {
      expect(dependencies).toBeDefined();
      expect(dependencies).toContain('"xdg-desktop-portal"');
      expect(dependencies).toContain('"xdg-desktop-portal-gtk"');
      expect(dependencies).toContain('"zenity"');
    }

    expect(patchFunction).toContain("xdg-desktop-portal");
    expect(patchFunction).toContain("xdg-desktop-portal-gtk");
    expect(patchFunction).toContain("zenity");
  });

  it("installs native dialog runtime dependencies in Linux development environments", () => {
    const setupScript = readRepoFile("scripts/setup/linux.sh");
    const primaryInstallCommands = setupScript
      .split("\n")
      .filter(
        (line) =>
          /sudo (apt-get|dnf|pacman|zypper)/.test(line) && line.includes("xdg-desktop-portal"),
      );

    expect(primaryInstallCommands).toHaveLength(4);
    for (const command of primaryInstallCommands) {
      expect(command).toContain("xdg-desktop-portal");
      expect(command).toContain("xdg-desktop-portal-gtk");
      expect(command).toContain("zenity");
    }
  });

  it("keeps the dialog plugin, permission, and Athas fallback surface connected", () => {
    const main = readRepoFile("src-tauri/src/main.rs");
    const capability = JSON.parse(readRepoFile("src-tauri/capabilities/main.json"));
    const mainLayout = readRepoFile("src/features/layout/components/main-layout.tsx");
    const platformController = readRepoFile("src/features/file-system/controllers/platform.ts");

    expect(main).toContain(".plugin(tauri_plugin_dialog::init())");
    expect(capability.permissions).toContain("dialog:allow-open");
    expect(mainLayout).toContain("<LinuxFolderPickerDialog />");
    expect(platformController).toContain("useLinuxFolderPickerStore.getState().actions.open()");
  });

  it("loads CEF from stable and preview native package resource directories", () => {
    const buildScript = readRepoFile("src-tauri/build.rs");
    const packagingScript = readRepoFile("scripts/release/packaging/linux/native.sh");

    expect(buildScript).toContain("$ORIGIN/../lib/Athas");
    expect(buildScript).toContain("$ORIGIN/../lib/Athas Preview");
    expect(packagingScript).toContain('product_name="Athas Preview"');
    expect(packagingScript).toContain('patchelf --print-rpath "$release_binary"');
    expect(packagingScript).toContain('expected_cef_rpath="\\$ORIGIN/../lib/${product_name}"');
  });

  it("does not add bundled extensions twice to native packages", () => {
    const config = JSON.parse(readRepoFile("src-tauri/tauri.conf.json"));
    const script = readRepoFile("scripts/release/packaging/linux/native.sh");

    expect(config.bundle.resources["../src/extensions/bundled/icon-themes"]).toBe(
      "bundled/icon-themes",
    );
    expect(script).not.toContain("src/extensions/bundled");
  });

  it("classifies Athas desktop entries for Linux application menus", () => {
    const config = JSON.parse(readRepoFile("src-tauri/tauri.conf.json"));
    const template = readRepoFile("src-tauri/linux/athas.desktop");
    const tarball = readRepoFile("scripts/release/packaging/linux/tarball.sh");
    const categories = "Categories=Utility;TextEditor;Development;";
    const keywords = "Keywords=Code;Editor;Text;Development;Programming;";

    expect(config.bundle.linux.deb.desktopTemplate).toBe("linux/athas.desktop");
    expect(config.bundle.linux.rpm.desktopTemplate).toBe("linux/athas.desktop");
    expect(template.split("\n")).toContain(categories);
    expect(template.split("\n")).toContain(keywords);
    expect(tarball).toContain(categories);
    expect(tarball).toContain(keywords);
  });

  it("builds Debian and RPM packages together in the release workflow", () => {
    const workflow = readRepoFile(".github/workflows/release.yml");
    const linuxBuild = workflow.indexOf("cargo tauri build --no-bundle");
    const nativePackages = workflow.indexOf("package-linux-native.sh packages");

    expect(linuxBuild).toBeGreaterThan(-1);
    expect(nativePackages).toBeGreaterThan(linuxBuild);
    expect(workflow).toContain("--no-default-features --features linux");
    expect(workflow).toContain("release-dist/*.deb");
    expect(workflow).toContain("release-dist/*.rpm");
  });

  it("does not force software rendering from the AppImage wrapper", () => {
    const script = readRepoFile("src-tauri/appimage-hooks/AppRun.wrapped");

    expect(script).not.toContain("--disable-gpu");
    expect(script).not.toContain("LIBGL_ALWAYS_SOFTWARE");
  });
});
