import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packagingScript = fs.readFileSync(
  path.resolve(import.meta.dirname, "../packaging/linux/tarball.sh"),
  "utf8",
);
const launcher = packagingScript.split("<<'EOF'\n")[1]?.split("\nEOF")[0];

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runLauncher({
  bundled = [],
  host = [],
  arch = "x86_64",
  preload = "",
  args = [],
}: {
  bundled?: string[];
  host?: string[];
  arch?: string;
  preload?: string;
  args?: string[];
}) {
  if (!launcher) throw new Error("Tarball launcher heredoc was not found");

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "athas-launcher-")));
  try {
    for (const file of [...bundled.map((name) => `/libexec/${name}`), ...host]) {
      const filePath = path.join(root, file);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "");
    }
    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir);
    const launcherPath = path.join(binDir, "athas");
    // Redirect only the host filesystem and final exec; run the real selection logic.
    const fixtureLauncher = launcher
      .replace(
        /^[ \t]+\/(?:usr\/)?lib\S*$/gm,
        (line) => `      ${shellQuote(path.join(root, line.trim()))}`,
      )
      .replace(
        '\ncase "$(uname -m)" in',
        `\nexport LD_PRELOAD=${shellQuote(preload)}\ncase "$(uname -m)" in`,
      );
    fs.writeFileSync(
      launcherPath,
      [
        `uname() { printf '%s\\n' ${shellQuote(arch)}; }`,
        `exec() { printf '%s\\0' "\${LD_PRELOAD-}" "$@"; }`,
        fixtureLauncher,
      ].join("\n"),
    );
    const env = { ...process.env };
    delete env.LD_PRELOAD;
    const result = spawnSync("bash", [launcherPath, ...args], { env, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const [selected, executable, ...forwardedArgs] = result.stdout.split("\0").slice(0, -1);
    expect(path.normalize(executable!)).toBe(path.join(root, "libexec/athas"));
    return {
      preloads: selected ? selected.split(":").map((file) => file.replace(root, "")) : [],
      args: forwardedArgs,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("Linux tarball launcher", () => {
  it("replaces only host-integration libraries, retaining compiler and CEF runtimes", () => {
    const integration = ["libxkbcommon.so.0", "libfontconfig.so.1", "libnssutil3.so"];
    const retained = [
      "libstdc++.so.6",
      "libgcc_s.so.1",
      "libcef.so",
      "libEGL.so",
      "libGLESv2.so",
      "libvk_swiftshader.so",
      "libvulkan.so.1",
      "libglib-2.0.so.0",
      "libunrelated.so.1",
    ];
    const libraries = [...integration, ...retained];
    const result = runLauncher({
      bundled: libraries,
      host: libraries.map((lib) => `/usr/lib/${lib}`),
    });
    expect(result.preloads).toEqual(integration.map((lib) => `/usr/lib/${lib}`));
  });

  it.each([
    ["x86_64", "/usr/lib/x86_64-linux-gnu"],
    ["x86_64", "/usr/lib64"],
    ["x86_64", "/usr/lib"],
    ["x86_64", "/lib/x86_64-linux-gnu"],
    ["aarch64", "/usr/lib/aarch64-linux-gnu"],
    ["aarch64", "/lib/aarch64-linux-gnu"],
    ["aarch64", "/lib64"],
    ["aarch64", "/lib"],
  ])("finds host libraries on %s in %s", (arch, dir) => {
    const file = `${dir}/libfontconfig.so.1`;
    expect(runLauncher({ arch, bundled: ["libfontconfig.so.1"], host: [file] }).preloads).toEqual([
      file,
    ]);
  });

  it("prefers the architecture-specific directory and does not preload both copies", () => {
    const file = "/usr/lib/x86_64-linux-gnu/libfontconfig.so.1";
    expect(
      runLauncher({
        bundled: ["libfontconfig.so.1"],
        host: [file, "/usr/lib/libfontconfig.so.1"],
      }).preloads,
    ).toEqual([file]);
  });

  it("keeps bundled libraries when host copies are unavailable", () => {
    expect(
      runLauncher({ bundled: ["libxkbcommon.so.0", "libfontconfig.so.1", "libnssutil3.so"] })
        .preloads,
    ).toEqual([]);
  });

  it("does not preload host libraries that are not bundled", () => {
    expect(runLauncher({ host: ["/usr/lib/libfontconfig.so.1"] }).preloads).toEqual([]);
  });

  it.each([
    { name: "XKB", libraries: ["libxkbcommon.so.0", "libxkbcommon-x11.so.0"] },
    {
      name: "NSS/NSPR",
      libraries: ["libnspr4.so", "libplc4.so", "libplds4.so", "libnssutil3.so", "libnss3.so"],
    },
  ])("switches the bundled $name group together", ({ libraries }) => {
    const host = libraries.map((lib) => `/usr/lib/${lib}`);
    expect(runLauncher({ bundled: libraries, host }).preloads).toEqual(host);
    for (const missing of host) {
      expect(
        runLauncher({
          bundled: [...libraries, "libfontconfig.so.1"],
          host: [...host.filter((file) => file !== missing), "/usr/lib/libfontconfig.so.1"],
        }).preloads,
      ).toEqual(["/usr/lib/libfontconfig.so.1"]);
    }
  });

  it.each([true, false])(
    "preserves caller preloads and arguments with host selection %s",
    (found) => {
      const file = "/usr/lib/libfontconfig.so.1";
      const result = runLauncher({
        bundled: ["libfontconfig.so.1"],
        host: found ? [file] : [],
        preload: "/custom/first.so:/custom/second.so",
        args: ["/workspace/with spaces", "--new-window", ""],
      });
      expect(result.preloads).toEqual([
        ...(found ? [file] : []),
        "/custom/first.so",
        "/custom/second.so",
      ]);
      expect(result.args).toEqual([
        "--ozone-platform=x11",
        "--disable-vulkan",
        "--disable-features=Vulkan",
        "/workspace/with spaces",
        "--new-window",
        "",
      ]);
    },
  );
});
