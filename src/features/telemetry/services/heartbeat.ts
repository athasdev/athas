import { getVersion } from "@tauri-apps/api/app";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { arch, platform } from "@tauri-apps/plugin-os";
import { getSettingsStore } from "@/features/settings/lib/settings-persistence";

const API_BASE = import.meta.env.VITE_API_URL || "https://athas.dev";
const HEARTBEAT_DELAY = 10_000;
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STORE_KEY_DEVICE_ID = "telemetry_device_id";
const STORE_KEY_LAST_HEARTBEAT = "telemetry_last_heartbeat";

async function getOrCreateDeviceId(): Promise<string> {
  const store = await getSettingsStore();
  const existing = await store.get<string>(STORE_KEY_DEVICE_ID);
  if (existing) return existing;

  const id = crypto.randomUUID();
  await store.set(STORE_KEY_DEVICE_ID, id);
  await store.save();
  return id;
}

async function shouldSendHeartbeat(): Promise<boolean> {
  const store = await getSettingsStore();
  const lastHeartbeat = await store.get<number>(STORE_KEY_LAST_HEARTBEAT);
  if (!lastHeartbeat) return true;
  return Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS;
}

async function markHeartbeatSent(): Promise<void> {
  const store = await getSettingsStore();
  await store.set(STORE_KEY_LAST_HEARTBEAT, Date.now());
  await store.save();
}

async function isTelemetryEnabled(): Promise<boolean> {
  const store = await getSettingsStore();
  const settings = await store.get<Record<string, unknown>>("settings");
  return settings?.telemetry === true;
}

async function sendHeartbeat(): Promise<void> {
  if (!(await isTelemetryEnabled())) return;
  if (!(await shouldSendHeartbeat())) return;

  const [deviceId, appVersion] = await Promise.all([getOrCreateDeviceId(), getVersion()]);

  const response = await tauriFetch(`${API_BASE}/api/telemetry/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: deviceId,
      app_version: appVersion,
      platform: platform(),
      arch: arch(),
    }),
  });

  if (response.ok) {
    await markHeartbeatSent();
  }
}

export function initializeHeartbeat(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      sendHeartbeat().catch((error) => {
        console.error("Heartbeat failed:", error);
      });
      resolve();
    }, HEARTBEAT_DELAY);
  });
}
