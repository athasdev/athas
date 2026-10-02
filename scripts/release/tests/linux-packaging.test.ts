import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function readRepoFile(filePath: string) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

function renderDesktopEntry() {
  const result = spawnSync(
    "bash",
    [
      "-c",
      'source scripts/release/packaging/linux/common.sh && render_linux_desktop_entry athas athas && echo "$desktop_id"',
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const lines = result.stdout.trimEnd().split("\n");
  return { entry: lines.slice(0, -1), desktopId: lines[lines.length - 1] };
}

describe("Linux release packaging", () => {
  it("creates the main window from config with the Athas title bar", () => {
    const config = JSON.parse(readRepoFile("src-tauri/tauri.linux.conf.json"));
    const [window] = config.app.windows;

    expect(window).not.toHaveProperty("create");
    expect(window.decorations).toBe(false);
    expect(window.transparent).toBe(false);
    expect(window.resizable).toBe(true);
    expect(window.preventOverflow).toBe(true);
    expect(window).not.toHaveProperty("titleBarStyle");
  });

  it("runs on the published Tauri system webview runtime", () => {
    const workspaceManifest = readRepoFile("Cargo.toml");
    const appManifest = readRepoFile("src-tauri/Cargo.toml");

    expect(workspaceManifest).not.toMatch(/^tauri = \{ git/m);
    expect(appManifest).not.toContain("tauri-runtime-cef");
    expect(appManifest).not.toContain("[features]");
    expect(appManifest).toMatch(/^tauri-build = "2\.\d+"/m);
  });

  it("uses the XDG portal dialog backend", () => {
    const dialogDependency = readRepoFile("src-tauri/Cargo.toml")
      .split("\n")
      .find((line) => line.startsWith("tauri-plugin-dialog ="));

    expect(dialogDependency).toBeDefined();
    expect(dialogDependency).toContain("default-features = false");
    expect(dialogDependency).toContain('"xdg-portal"');
    expect(dialogDependency).not.toContain('"gtk3"');
  });

  it("recommends the portal file chooser and its fallback in native packages", () => {
    const { linux } = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).bundle;

    for (const format of [linux.deb, linux.rpm]) {
      expect(format.desktopTemplate).toBe("linux/athas.desktop");
      expect(format.recommends).toEqual(["xdg-desktop-portal", "zenity"]);
    }
    expect(linux.appimage.bundleMediaFramework).toBe(false);
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
      expect(command).toMatch(/webkit2gtk/);
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

  it("renders the shared desktop template for the tarball and Flatpak", () => {
    const stable = renderDesktopEntry();

    expect(stable.desktopId).toBe("com.code.athas");
    expect(stable.entry).toContain("Exec=athas");
    expect(stable.entry).toContain("StartupWMClass=athas");
    expect(stable.entry).toContain("Name=Athas");
    expect(stable.entry).toContain("MimeType=x-scheme-handler/athas");
    expect(stable.entry).toContain("Categories=Utility;TextEditor;Development;");
    expect(stable.entry.join("\n")).not.toContain("{{");
  });

  it("lays out the tarball the way Tauri, Nix and install.sh expect", () => {
    const script = readRepoFile("scripts/release/packaging/linux/tarball.sh");
    const nixPackage = readRepoFile("nix/package.nix");

    expect(script).toContain('install -D -m 755 "$binary" "${app_root}/bin/athas"');
    expect(script).toContain('resource_dir="${app_root}/lib/${product_name}"');
    expect(script).toContain("__TAURI_BUNDLE_TYPE_VAR_UNK");
    expect(script).not.toMatch(/libcef|libexec|LD_PRELOAD/);
    expect(nixPackage).toContain("webkitgtk_4_1");
    expect(nixPackage).toContain("cp -r bin lib share $out/");
  });

  it("builds the Flatpak from the release tarball on the GNOME runtime", () => {
    const manifest = readRepoFile("flatpak/com.code.athas.yml");
    const metainfo = readRepoFile("flatpak/com.code.athas.metainfo.xml");
    const script = readRepoFile("scripts/release/packaging/linux/flatpak.sh");

    expect(manifest).toContain("id: com.code.athas");
    expect(manifest).toContain("runtime: org.gnome.Platform");
    expect(manifest).toMatch(/runtime-version: "\d+"/);
    expect(manifest).toContain("command: athas");
    for (const permission of [
      "--filesystem=host",
      "--filesystem=host-os:ro",
      "--talk-name=org.freedesktop.Flatpak",
      "--socket=wayland",
      "--socket=fallback-x11",
      "--device=dri",
      "--share=network",
    ]) {
      expect(manifest).toContain(`- ${permission}\n`);
    }
    expect(manifest).toContain("path: athas.tar.gz");
    expect(metainfo).toContain("<id>com.code.athas</id>");
    expect(metainfo).toContain('<launchable type="desktop-id">com.code.athas.desktop</launchable>');
    expect(metainfo).toContain('<release version="@VERSION@" date="@DATE@" />');
    expect(script).toContain('cp "$tarball" "${work_dir}/athas.tar.gz"');
    expect(script).toContain("flatpak build-bundle");
  });

  it("builds every Linux package with the stock Tauri bundler in the release workflow", () => {
    const workflow = readRepoFile(".github/workflows/release.yml");

    expect(workflow).toContain('args: "--bundles deb,rpm,appimage"');
    expect(workflow).toContain("libwebkit2gtk-4.1-dev");
    expect(workflow).toContain("bash scripts/release/package-linux-tarball.sh");
    expect(workflow).toContain("bash scripts/release/packaging/linux/flatpak.sh");
    expect(workflow).toContain("release-dist/*.flatpak");
    expect(workflow).not.toMatch(/cef|--features linux|cargo tauri/i);
  });

  it("starts Flatpak terminals on the host", () => {
    const connection = readRepoFile("crates/terminal/src/connection.rs");

    expect(connection).toContain("flatpak::host_pty_command(&cmd)");
    expect(connection).toContain("flatpak::host_command(&shell)");
  });
});
