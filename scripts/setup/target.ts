export type SetupTarget = "linux" | "macos" | "windows";

export function getSetupTarget(platform: NodeJS.Platform): SetupTarget | null {
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
