import { getVersion } from "@tauri-apps/api/app";

export async function getAppVersion(): Promise<string> {
  return await getVersion();
}

export async function describeOperatingSystem(): Promise<string> {
  const os = await import("@tauri-apps/plugin-os");
  return `${os.platform()} ${os.version()}`;
}
