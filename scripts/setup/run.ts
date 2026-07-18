import { $ } from "bun";
import { getSetupTarget } from "./target";

export async function runSetup(platform: NodeJS.Platform = process.platform) {
  const target = getSetupTarget(platform);

  switch (target) {
    case "linux":
      await $`bash scripts/setup/linux.sh`;
      return;
    case "macos":
      await $`bash scripts/setup/macos.sh`;
      return;
    case "windows":
      await $`powershell -ExecutionPolicy Bypass -File scripts/setup/windows.ps1`;
      return;
    default:
      throw new Error(`Unsupported setup platform: ${platform}`);
  }
}

if (import.meta.main) {
  await runSetup();
}
