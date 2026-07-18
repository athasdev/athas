import path from "node:path";

export type SmokeIdentity = "stable" | "preview" | "smoke";
export type SmokePlatform = "macos" | "linux" | "windows";

export type SmokeOptions = {
  identity: SmokeIdentity;
  openOnly: boolean;
  targetPlatform: SmokePlatform;
};

export const smokeTargets: Record<SmokeIdentity, { config?: string; macosAppName: string }> = {
  stable: {
    macosAppName: "Athas.app",
  },
  preview: {
    config: "src-tauri/tauri.preview.conf.json",
    macosAppName: "Athas Preview.app",
  },
  smoke: {
    config: "src-tauri/tauri.smoke.conf.json",
    macosAppName: "Athas Smoke.app",
  },
};

export function getSmokePlatform(platform: NodeJS.Platform): SmokePlatform | null {
  switch (platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return null;
  }
}

function readOption(args: string[], name: string) {
  const prefix = `${name}=`;
  const equalsValue = args.find((arg) => arg.startsWith(prefix));
  if (equalsValue) {
    return equalsValue.slice(prefix.length);
  }

  const optionIndex = args.indexOf(name);
  return optionIndex === -1 ? undefined : args[optionIndex + 1];
}

export function parseSmokeOptions(args: string[], host: NodeJS.Platform): SmokeOptions {
  const hostPlatform = getSmokePlatform(host);
  const platform = (readOption(args, "--platform") ?? hostPlatform)?.toLowerCase();

  if (platform !== "macos" && platform !== "linux" && platform !== "windows") {
    throw new Error("Invalid smoke platform");
  }

  if (hostPlatform !== platform) {
    throw new Error(
      `Smoke target ${platform} must be run on ${platform}; current platform is ${hostPlatform}.`,
    );
  }

  const identity = (readOption(args, "--identity") ?? "smoke").toLowerCase();
  if (identity !== "stable" && identity !== "preview" && identity !== "smoke") {
    throw new Error("Invalid smoke identity");
  }

  return {
    identity,
    openOnly: args.includes("--open-only"),
    targetPlatform: platform,
  };
}

export function getSmokeLaunchPath(cwd: string, platform: SmokePlatform, identity: SmokeIdentity) {
  switch (platform) {
    case "macos":
      return path.resolve(
        cwd,
        "target",
        "debug",
        "bundle",
        "macos",
        smokeTargets[identity].macosAppName,
      );
    case "linux":
      return path.join(cwd, "target", "debug", "athas");
    case "windows":
      return path.join(cwd, "target", "debug", "athas.exe");
  }
}
