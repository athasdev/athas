import os from "node:os";
import { $ } from "bun";

const WINDOWS = "win32";
const MAC = "darwin";
const LINUX = "linux";

const platform = os.platform();

if (platform === WINDOWS) {
  await $`powershell -ExecutionPolicy Bypass -File ./scripts/windows/setup.ps1`;
} else if (platform === MAC || platform === LINUX) {
  await $`chmod +x scripts/linux/setup.sh && ./scripts/linux/setup.sh`;
}
