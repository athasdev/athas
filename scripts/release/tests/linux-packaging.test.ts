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

    expect(window.transparent).toBe(false);
    expect(window.decorations).toBe(true);
    expect(window).not.toHaveProperty("titleBarStyle");
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

  it("builds Debian and RPM packages together in the release workflow", () => {
    const workflow = readRepoFile(".github/workflows/release.yml");

    expect(workflow).toContain("package-linux-native.sh packages");
    expect(workflow).toContain("release-dist/*.deb");
    expect(workflow).toContain("release-dist/*.rpm");
  });

  it("does not force software rendering from the AppImage wrapper", () => {
    const script = readRepoFile("src-tauri/appimage-hooks/AppRun.wrapped");

    expect(script).not.toContain("--disable-gpu");
    expect(script).not.toContain("LIBGL_ALWAYS_SOFTWARE");
  });
});
