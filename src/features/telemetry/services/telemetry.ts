import { getVersion } from "@tauri-apps/api/app";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { arch, platform } from "@tauri-apps/plugin-os";
import { getSettingsStore } from "@/features/settings/lib/settings-persistence";
import { getApiBase } from "@/utils/api-base";

const API_BASE = getApiBase();
const STARTUP_DELAY_MS = 10_000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const QUEUE_FLUSH_THRESHOLD = 50;
const MAX_QUEUE_LENGTH = 200;
const MAX_LOG_ENTRIES = 150;

const STORE_KEY_DEVICE_ID = "telemetry_device_id";
const STORE_KEY_LAST_HEARTBEAT = "telemetry_last_heartbeat";
const STORE_KEY_QUEUE = "telemetry_queue_v1";
const STORE_KEY_LOG = "telemetry_log_v1";
const STORE_KEY_INSTALL_DATE = "telemetry_install_date";
const STORE_KEY_LAUNCH_COUNT = "telemetry_launch_count";
const STORE_KEY_LAST_APP_VERSION = "telemetry_last_app_version";

type TelemetryEventType =
  | "heartbeat"
  | "update_check"
  | "extension_registry_sync"
  | "extension_update_check"
  | "extension_install"
  | "extension_uninstall"
  | "extension_update"
  | "crash_report";

type TelemetryLogStatus = "queued" | "sent" | "failed" | "dropped" | "cleared";

interface QueuedTelemetryEvent {
  id: string;
  type: TelemetryEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface TelemetryLogEntry {
  id: string;
  timestamp: string;
  status: TelemetryLogStatus;
  eventType: string;
  summary: string;
  error?: string;
}

interface TelemetryClientContext {
  deviceId: string;
  appVersion: string;
  platform: string;
  arch: string;
  installDate: string;
  previousVersion: string | null;
  launchCount: number;
}

type TelemetryLogSubscriber = (entries: TelemetryLogEntry[]) => void;
type TelemetryMode = "required" | "optional";

let clientContextPromise: Promise<TelemetryClientContext> | null = null;
let initializationPromise: Promise<void> | null = null;
let flushInFlight: Promise<boolean> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let listenersRegistered = false;
const logSubscribers = new Set<TelemetryLogSubscriber>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function sanitizePayload(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizePayload(entry)]),
    );
  }

  return String(value);
}

async function getOrCreateDeviceId() {
  const store = await getSettingsStore();
  const existing = await store.get<string>(STORE_KEY_DEVICE_ID);
  if (existing) return existing;

  const id = crypto.randomUUID();
  await store.set(STORE_KEY_DEVICE_ID, id);
  await store.save();
  return id;
}

async function loadQueue(
  storeArg?: Awaited<ReturnType<typeof getSettingsStore>>,
): Promise<QueuedTelemetryEvent[]> {
  const store = storeArg ?? (await getSettingsStore());
  const queue = await store.get<unknown>(STORE_KEY_QUEUE);
  if (!Array.isArray(queue)) return [];

  return queue.filter((entry): entry is QueuedTelemetryEvent => {
    return (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.type === "string" &&
      typeof entry.occurredAt === "string" &&
      isRecord(entry.payload)
    );
  });
}

async function saveQueue(
  queue: QueuedTelemetryEvent[],
  storeArg?: Awaited<ReturnType<typeof getSettingsStore>>,
) {
  const store = storeArg ?? (await getSettingsStore());
  await store.set(STORE_KEY_QUEUE, queue);
  await store.save();
}

async function loadLogEntries(
  storeArg?: Awaited<ReturnType<typeof getSettingsStore>>,
): Promise<TelemetryLogEntry[]> {
  const store = storeArg ?? (await getSettingsStore());
  const log = await store.get<unknown>(STORE_KEY_LOG);
  if (!Array.isArray(log)) return [];

  return log.filter((entry): entry is TelemetryLogEntry => {
    return (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.timestamp === "string" &&
      typeof entry.status === "string" &&
      typeof entry.eventType === "string" &&
      typeof entry.summary === "string"
    );
  });
}

async function persistLogEntries(
  entries: TelemetryLogEntry[],
  storeArg?: Awaited<ReturnType<typeof getSettingsStore>>,
) {
  const store = storeArg ?? (await getSettingsStore());
  const limitedEntries = entries.slice(-MAX_LOG_ENTRIES);
  await store.set(STORE_KEY_LOG, limitedEntries);
  await store.save();
  notifyLogSubscribers(limitedEntries);
}

function notifyLogSubscribers(entries: TelemetryLogEntry[]) {
  for (const subscriber of logSubscribers) {
    subscriber(entries);
  }
}

async function appendLogEntry(
  entry: Omit<TelemetryLogEntry, "id" | "timestamp">,
  storeArg?: Awaited<ReturnType<typeof getSettingsStore>>,
) {
  const store = storeArg ?? (await getSettingsStore());
  const entries = await loadLogEntries(store);
  entries.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  await persistLogEntries(entries, store);
}

async function ensureClientContext(): Promise<TelemetryClientContext> {
  if (clientContextPromise) return clientContextPromise;

  clientContextPromise = (async () => {
    const store = await getSettingsStore();
    const [deviceId, appVersion] = await Promise.all([getOrCreateDeviceId(), getVersion()]);

    const nowIso = new Date().toISOString();
    const installDate = (await store.get<string>(STORE_KEY_INSTALL_DATE)) ?? nowIso;
    const previousVersion = (await store.get<string>(STORE_KEY_LAST_APP_VERSION)) ?? null;
    const launchCount = ((await store.get<number>(STORE_KEY_LAUNCH_COUNT)) ?? 0) + 1;

    await store.set(STORE_KEY_INSTALL_DATE, installDate);
    await store.set(STORE_KEY_LAUNCH_COUNT, launchCount);
    await store.set(STORE_KEY_LAST_APP_VERSION, appVersion);
    await store.save();

    return {
      deviceId,
      appVersion,
      platform: platform(),
      arch: arch(),
      installDate,
      previousVersion: previousVersion === appVersion ? null : previousVersion,
      launchCount,
    };
  })();

  return clientContextPromise;
}

async function isUsageTelemetryEnabled(): Promise<boolean> {
  const store = await getSettingsStore();
  const telemetrySetting = await store.get<unknown>("telemetry");
  if (typeof telemetrySetting === "boolean") {
    return telemetrySetting;
  }

  const legacySettings = await store.get<Record<string, unknown>>("settings");
  return legacySettings?.telemetry === true;
}

async function shouldQueueHeartbeat(): Promise<boolean> {
  const store = await getSettingsStore();
  const lastHeartbeat = await store.get<number>(STORE_KEY_LAST_HEARTBEAT);
  if (!lastHeartbeat) return true;
  return Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS;
}

async function markHeartbeatQueued() {
  const store = await getSettingsStore();
  await store.set(STORE_KEY_LAST_HEARTBEAT, Date.now());
  await store.save();
}

function summarizeExtensions(
  extensions: Array<{ id: string; version?: string | null }>,
): Array<{ id: string; version: string | null }> {
  return extensions.map((extension) => ({
    id: extension.id,
    version: extension.version ?? null,
  }));
}

async function enqueueTelemetryEvent(
  type: TelemetryEventType,
  payload: Record<string, unknown>,
  options?: { flushImmediately?: boolean; mode?: TelemetryMode },
): Promise<boolean> {
  const mode = options?.mode ?? "optional";
  if (mode === "optional" && !(await isUsageTelemetryEnabled())) return false;

  const store = await getSettingsStore();
  const context = await ensureClientContext();
  const queue = await loadQueue(store);

  const event: QueuedTelemetryEvent = {
    id: crypto.randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    payload: sanitizePayload({
      ...payload,
      install_date: context.installDate,
      previous_version: context.previousVersion,
      launch_count: context.launchCount,
    }) as Record<string, unknown>,
  };

  queue.push(event);

  while (queue.length > MAX_QUEUE_LENGTH) {
    const dropped = queue.shift();
    if (dropped) {
      await appendLogEntry(
        {
          status: "dropped",
          eventType: dropped.type,
          summary: `Dropped ${dropped.type} from local queue to stay under ${MAX_QUEUE_LENGTH} events`,
        },
        store,
      );
    }
  }

  await saveQueue(queue, store);
  await appendLogEntry(
    {
      status: "queued",
      eventType: type,
      summary: `Queued ${type}`,
    },
    store,
  );

  if (options?.flushImmediately || queue.length >= QUEUE_FLUSH_THRESHOLD) {
    void flushTelemetryQueue();
  }

  return true;
}

export async function flushTelemetryQueue(): Promise<boolean> {
  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async () => {
    const store = await getSettingsStore();
    const queue = await loadQueue(store);
    if (queue.length === 0) return true;

    const context = await ensureClientContext();

    try {
      for (let index = 0; index < queue.length; index += QUEUE_FLUSH_THRESHOLD) {
        const chunk = queue.slice(index, index + QUEUE_FLUSH_THRESHOLD);
        const response = await tauriFetch(`${API_BASE}/api/telemetry/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_id: context.deviceId,
            app_version: context.appVersion,
            platform: context.platform,
            arch: context.arch,
            events: chunk.map((event) => ({
              id: event.id,
              type: event.type,
              occurred_at: event.occurredAt,
              payload: event.payload,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`Telemetry upload failed (${response.status})`);
        }
      }

      await saveQueue([], store);
      await appendLogEntry(
        {
          status: "sent",
          eventType: "batch",
          summary: `Sent ${queue.length} telemetry event${queue.length === 1 ? "" : "s"}`,
        },
        store,
      );

      return true;
    } catch (error) {
      const details = serializeError(error);
      await appendLogEntry(
        {
          status: "failed",
          eventType: "batch",
          summary: `Failed to send ${queue.length} telemetry event${queue.length === 1 ? "" : "s"}`,
          error: details.message,
        },
        store,
      );
      return false;
    } finally {
      flushInFlight = null;
    }
  })();

  return flushInFlight;
}

async function queueHeartbeat() {
  if (!(await shouldQueueHeartbeat())) return;

  const context = await ensureClientContext();
  const queued = await enqueueTelemetryEvent("heartbeat", {
    updater_enabled: true,
    session_platform: context.platform,
    session_arch: context.arch,
  });

  if (queued) {
    await markHeartbeatQueued();
  }
}

function registerCrashListeners() {
  if (listenersRegistered || typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    void recordCrashReport({
      kind: "window_error",
      message: event.message,
      source: event.filename || null,
      line: event.lineno || null,
      column: event.colno || null,
      stack: event.error instanceof Error ? event.error.stack || null : null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const details = serializeError(event.reason);
    void recordCrashReport({
      kind: "unhandled_rejection",
      message: details.message,
      stack: details.stack || null,
    });
  });

  listenersRegistered = true;
}

export async function recordCrashReport(payload: Record<string, unknown>) {
  return enqueueTelemetryEvent(
    "crash_report",
    {
      ...payload,
      report_source: "desktop_runtime",
    },
    { flushImmediately: true, mode: "optional" },
  );
}

export async function recordUpdateCheckTelemetry(payload: {
  status: "available" | "up_to_date" | "failed";
  availableVersion?: string | null;
  currentVersion: string;
  error?: string | null;
}) {
  return enqueueTelemetryEvent(
    "update_check",
    {
      ...payload,
      updater_enabled: true,
    },
    { mode: "required" },
  );
}

export async function recordExtensionRegistrySync(payload: {
  installedExtensions: Array<{ id: string; version?: string | null }>;
}) {
  return enqueueTelemetryEvent(
    "extension_registry_sync",
    {
      installed_extensions: summarizeExtensions(payload.installedExtensions),
      installed_count: payload.installedExtensions.length,
    },
    { mode: "optional" },
  );
}

export async function recordExtensionUpdateCheck(payload: {
  installedExtensions: Array<{ id: string; version?: string | null }>;
  updates: string[];
}) {
  return enqueueTelemetryEvent(
    "extension_update_check",
    {
      installed_extensions: summarizeExtensions(payload.installedExtensions),
      update_candidates: payload.updates,
      installed_count: payload.installedExtensions.length,
      update_count: payload.updates.length,
    },
    { mode: "optional" },
  );
}

export async function recordExtensionLifecycleTelemetry(payload: {
  type: "extension_install" | "extension_uninstall" | "extension_update";
  extensionId: string;
  version?: string | null;
}) {
  return enqueueTelemetryEvent(
    payload.type,
    {
      extension_id: payload.extensionId,
      extension_version: payload.version ?? null,
    },
    { mode: "optional" },
  );
}

export async function getTelemetryLogEntries(): Promise<TelemetryLogEntry[]> {
  return loadLogEntries();
}

export async function clearTelemetryLogEntries() {
  const store = await getSettingsStore();
  await persistLogEntries([], store);
  await appendLogEntry(
    {
      status: "cleared",
      eventType: "log",
      summary: "Cleared local telemetry log",
    },
    store,
  );
}

export function subscribeToTelemetryLog(subscriber: TelemetryLogSubscriber) {
  logSubscribers.add(subscriber);
  void getTelemetryLogEntries().then((entries) => subscriber(entries));

  return () => {
    logSubscribers.delete(subscriber);
  };
}

export function initializeTelemetry(): Promise<void> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = new Promise((resolve) => {
    setTimeout(() => {
      registerCrashListeners();
      void ensureClientContext()
        .then(() => queueHeartbeat())
        .catch((error) => {
          console.error("Telemetry initialization failed:", error);
        });

      if (!flushTimer) {
        flushTimer = setInterval(() => {
          void flushTelemetryQueue();
        }, FLUSH_INTERVAL_MS);
      }

      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => {
          void queueHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);
      }

      resolve();
    }, STARTUP_DELAY_MS);
  });

  return initializationPromise;
}
