import type { Settings } from "@/features/settings/types/settings";
import { useSettingsStore } from "@/features/settings/store";
import {
  useSettingsSyncStore,
  type SettingsSyncSource,
} from "@/features/settings/stores/settings-sync-store";
import {
  fetchSettingsSyncSnapshot,
  isAuthInvalidError,
  pushSettingsSyncSnapshot,
  type CloudSettingsSyncSnapshot,
} from "@/features/window/services/auth-api";

const SETTINGS_SYNC_META_KEY = "athas.settingsSync.meta";
const SETTINGS_SYNC_SCHEMA_VERSION = 1;
const SETTINGS_SYNC_PUSH_DEBOUNCE_MS = 1500;

type SyncableSettingsKey =
  | "autoSave"
  | "sidebarPosition"
  | "quickOpenPreview"
  | "fontFamily"
  | "fontSize"
  | "editorLineHeight"
  | "tabSize"
  | "wordWrap"
  | "lineNumbers"
  | "showMinimap"
  | "terminalFontFamily"
  | "terminalFontSize"
  | "terminalLineHeight"
  | "terminalLetterSpacing"
  | "terminalScrollback"
  | "terminalCursorStyle"
  | "terminalCursorBlink"
  | "terminalCursorWidth"
  | "uiFontFamily"
  | "uiFontSize"
  | "theme"
  | "iconTheme"
  | "syncSystemTheme"
  | "autoThemeLight"
  | "autoThemeDark"
  | "compactMenuBar"
  | "sidebarTabsPosition"
  | "titleBarProjectMode"
  | "headerTrailingItemsOrder"
  | "sidebarActivityItemsOrder"
  | "footerLeadingItemsOrder"
  | "footerTrailingItemsOrder"
  | "openFoldersInNewWindow"
  | "aiProviderId"
  | "aiModelId"
  | "aiChatWidth"
  | "isAIChatVisible"
  | "aiCompletion"
  | "aiAutocompleteModelId"
  | "aiDefaultSessionMode"
  | "aiSkills"
  | "ollamaBaseUrl"
  | "sidebarWidth"
  | "showGitHubPullRequests"
  | "showGitHubIssues"
  | "showGitHubActions"
  | "keybindingPreset"
  | "vimMode"
  | "vimRelativeLineNumbers"
  | "defaultLanguage"
  | "autoDetectLanguage"
  | "formatOnSave"
  | "formatter"
  | "lintOnSave"
  | "autoCompletion"
  | "parameterHints"
  | "externalEditor"
  | "coreFeatures"
  | "extensionsActiveTab"
  | "maxOpenTabs"
  | "horizontalTabScroll"
  | "hiddenFilePatterns"
  | "hiddenDirectoryPatterns"
  | "gitChangesFolderView"
  | "confirmBeforeDiscard"
  | "autoRefreshGitStatus"
  | "showUntrackedFiles"
  | "showStagedFirst"
  | "gitDefaultDiffView"
  | "openDiffOnClick"
  | "showGitStatusInFileTree"
  | "compactGitStatusBadges"
  | "collapseEmptyGitSections"
  | "rememberLastGitPanelMode"
  | "gitLastPanelMode"
  | "gitSidebarTabOrder"
  | "githubSidebarSectionOrder"
  | "enableInlineGitBlame"
  | "enableGitGutter"
  | "telemetry";

const SYNCABLE_SETTINGS_KEYS: SyncableSettingsKey[] = [
  "autoSave",
  "sidebarPosition",
  "quickOpenPreview",
  "fontFamily",
  "fontSize",
  "editorLineHeight",
  "tabSize",
  "wordWrap",
  "lineNumbers",
  "showMinimap",
  "terminalFontFamily",
  "terminalFontSize",
  "terminalLineHeight",
  "terminalLetterSpacing",
  "terminalScrollback",
  "terminalCursorStyle",
  "terminalCursorBlink",
  "terminalCursorWidth",
  "uiFontFamily",
  "uiFontSize",
  "theme",
  "iconTheme",
  "syncSystemTheme",
  "autoThemeLight",
  "autoThemeDark",
  "compactMenuBar",
  "sidebarTabsPosition",
  "titleBarProjectMode",
  "headerTrailingItemsOrder",
  "sidebarActivityItemsOrder",
  "footerLeadingItemsOrder",
  "footerTrailingItemsOrder",
  "openFoldersInNewWindow",
  "aiProviderId",
  "aiModelId",
  "aiChatWidth",
  "isAIChatVisible",
  "aiCompletion",
  "aiAutocompleteModelId",
  "aiDefaultSessionMode",
  "aiSkills",
  "ollamaBaseUrl",
  "sidebarWidth",
  "showGitHubPullRequests",
  "showGitHubIssues",
  "showGitHubActions",
  "keybindingPreset",
  "vimMode",
  "vimRelativeLineNumbers",
  "defaultLanguage",
  "autoDetectLanguage",
  "formatOnSave",
  "formatter",
  "lintOnSave",
  "autoCompletion",
  "parameterHints",
  "externalEditor",
  "coreFeatures",
  "extensionsActiveTab",
  "maxOpenTabs",
  "horizontalTabScroll",
  "hiddenFilePatterns",
  "hiddenDirectoryPatterns",
  "gitChangesFolderView",
  "confirmBeforeDiscard",
  "autoRefreshGitStatus",
  "showUntrackedFiles",
  "showStagedFirst",
  "gitDefaultDiffView",
  "openDiffOnClick",
  "showGitStatusInFileTree",
  "compactGitStatusBadges",
  "collapseEmptyGitSections",
  "rememberLastGitPanelMode",
  "gitLastPanelMode",
  "gitSidebarTabOrder",
  "githubSidebarSectionOrder",
  "enableInlineGitBlame",
  "enableGitGutter",
  "telemetry",
];

interface SettingsSyncMeta {
  enabled: boolean;
  localUpdatedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncSource: SettingsSyncSource | null;
}

const DEFAULT_META: SettingsSyncMeta = {
  enabled: false,
  localUpdatedAt: null,
  lastSyncedAt: null,
  lastSyncSource: null,
};

let currentSubscription: (() => void) | null = null;
let pushTimeout: ReturnType<typeof setTimeout> | null = null;
let isApplyingRemoteSnapshot = false;
let lastUploadedPayloadJson: string | null = null;
let hasCompletedInitialSync = false;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMeta(): SettingsSyncMeta {
  if (!canUseStorage()) {
    return DEFAULT_META;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_SYNC_META_KEY);
    if (!raw) {
      return DEFAULT_META;
    }

    const parsed = JSON.parse(raw) as Partial<SettingsSyncMeta>;
    return {
      enabled: parsed.enabled === true,
      localUpdatedAt: typeof parsed.localUpdatedAt === "string" ? parsed.localUpdatedAt : null,
      lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : null,
      lastSyncSource:
        parsed.lastSyncSource === "cloud" || parsed.lastSyncSource === "local"
          ? parsed.lastSyncSource
          : null,
    };
  } catch {
    return DEFAULT_META;
  }
}

function writeMeta(patch: Partial<SettingsSyncMeta>): SettingsSyncMeta {
  const next = { ...readMeta(), ...patch };
  if (canUseStorage()) {
    window.localStorage.setItem(SETTINGS_SYNC_META_KEY, JSON.stringify(next));
  }
  return next;
}

function getTimestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSyncableSettingsSnapshot(settings: Settings): Record<string, unknown> {
  return Object.fromEntries(SYNCABLE_SETTINGS_KEYS.map((key) => [key, settings[key]]));
}

function hydrateSettingsSyncStore() {
  const meta = readMeta();
  useSettingsSyncStore.getState().actions.hydrate({
    enabled: meta.enabled,
    lastSyncedAt: meta.lastSyncedAt,
    lastSyncSource: meta.lastSyncSource,
  });
}

async function applyRemoteSnapshot(snapshot: CloudSettingsSyncSnapshot) {
  isApplyingRemoteSnapshot = true;
  try {
    const success = useSettingsStore
      .getState()
      .updateSettingsFromJSON(JSON.stringify(snapshot.settings));
    if (!success) {
      throw new Error("Could not apply cloud settings.");
    }

    lastUploadedPayloadJson = JSON.stringify(snapshot.settings);
    writeMeta({
      localUpdatedAt: snapshot.updatedAt,
      lastSyncedAt: snapshot.updatedAt,
      lastSyncSource: "cloud",
    });
    useSettingsSyncStore.getState().actions.finishSync({
      updatedAt: snapshot.updatedAt,
      source: "cloud",
    });
  } finally {
    isApplyingRemoteSnapshot = false;
  }
}

async function pushLocalSnapshot(source: SettingsSyncSource = "local") {
  const settings = useSettingsStore.getState().settings;
  const payload = buildSyncableSettingsSnapshot(settings);
  const payloadJson = JSON.stringify(payload);

  if (payloadJson === lastUploadedPayloadJson) {
    const meta = readMeta();
    if (meta.lastSyncedAt) {
      useSettingsSyncStore.getState().actions.finishSync({
        updatedAt: meta.lastSyncedAt,
        source: meta.lastSyncSource ?? source,
      });
    } else {
      useSettingsSyncStore.getState().actions.clearSyncState();
    }
    return;
  }

  useSettingsSyncStore.getState().actions.startSync();
  const snapshot = await pushSettingsSyncSnapshot({
    schemaVersion: SETTINGS_SYNC_SCHEMA_VERSION,
    settings: payload,
  });
  lastUploadedPayloadJson = payloadJson;
  writeMeta({
    localUpdatedAt: snapshot.updatedAt,
    lastSyncedAt: snapshot.updatedAt,
    lastSyncSource: source,
  });
  useSettingsSyncStore.getState().actions.finishSync({
    updatedAt: snapshot.updatedAt,
    source,
  });
}

async function runInitialSettingsSync() {
  useSettingsSyncStore.getState().actions.startSync();
  const meta = readMeta();
  const remoteSnapshot = await fetchSettingsSyncSnapshot();

  if (!remoteSnapshot) {
    await pushLocalSnapshot("local");
    return;
  }

  const remoteUpdatedAtMs = getTimestampMs(remoteSnapshot.updatedAt);
  const localUpdatedAtMs = getTimestampMs(meta.localUpdatedAt);

  if (remoteUpdatedAtMs >= localUpdatedAtMs) {
    await applyRemoteSnapshot(remoteSnapshot);
    return;
  }

  await pushLocalSnapshot("local");
}

function schedulePush() {
  if (pushTimeout) {
    clearTimeout(pushTimeout);
  }

  pushTimeout = setTimeout(() => {
    pushTimeout = null;
    void pushLocalSnapshot("local").catch((error) => {
      const message = error instanceof Error ? error.message : "Settings sync failed.";
      useSettingsSyncStore.getState().actions.setError(message);
    });
  }, SETTINGS_SYNC_PUSH_DEBOUNCE_MS);
}

function ensureSettingsSubscription() {
  if (currentSubscription) {
    return;
  }

  currentSubscription = useSettingsStore.subscribe((state, previousState) => {
    if (state.settings === previousState.settings || isApplyingRemoteSnapshot) {
      return;
    }

    const syncState = useSettingsSyncStore.getState();
    if (!syncState.enabled) {
      return;
    }

    writeMeta({ localUpdatedAt: new Date().toISOString() });
    schedulePush();
  });
}

function clearSettingsSubscription() {
  if (currentSubscription) {
    currentSubscription();
    currentSubscription = null;
  }

  if (pushTimeout) {
    clearTimeout(pushTimeout);
    pushTimeout = null;
  }
}

function getSettingsSyncErrorMessage(error: unknown): string {
  if (isAuthInvalidError(error)) {
    return "Cloud settings sync could not access your account. Your session is still signed in.";
  }

  return error instanceof Error ? error.message : "Settings sync failed.";
}

function handleSettingsSyncError(error: unknown, options?: { disable?: boolean }) {
  const message = getSettingsSyncErrorMessage(error);

  if (options?.disable) {
    writeMeta({ enabled: false });
    clearSettingsSubscription();
    useSettingsSyncStore.getState().actions.setEnabled(false);
  }

  useSettingsSyncStore.getState().actions.setError(message);

  return message;
}

export function initializeSettingsSyncPreferences() {
  hydrateSettingsSyncStore();
  hasCompletedInitialSync = false;
}

export async function enableSettingsSync(): Promise<void> {
  writeMeta({ enabled: true });
  useSettingsSyncStore.getState().actions.setEnabled(true);
  try {
    await runInitialSettingsSync();
    ensureSettingsSubscription();
  } catch (error) {
    const message = handleSettingsSyncError(error, { disable: true });
    throw new Error(message);
  }
}

export function disableSettingsSync() {
  writeMeta({ enabled: false });
  useSettingsSyncStore.getState().actions.setEnabled(false);
  useSettingsSyncStore.getState().actions.clearSyncState();
  clearSettingsSubscription();
}

export async function syncSettingsNow(): Promise<void> {
  try {
    await pushLocalSnapshot("local");
  } catch (error) {
    const message = handleSettingsSyncError(error);
    throw new Error(message);
  }
}

export async function restoreSettingsFromCloud(): Promise<void> {
  try {
    useSettingsSyncStore.getState().actions.startSync();
    const snapshot = await fetchSettingsSyncSnapshot();
    if (!snapshot) {
      const message = "No cloud settings snapshot found yet.";
      useSettingsSyncStore.getState().actions.setError(message);
      throw new Error(message);
    }

    await applyRemoteSnapshot(snapshot);
  } catch (error) {
    const message = handleSettingsSyncError(error);
    throw new Error(message);
  }
}

export async function ensureSettingsSyncStarted(params: {
  isAuthenticated: boolean;
  isPro: boolean;
}) {
  const meta = readMeta();

  if (!params.isAuthenticated || !params.isPro || !meta.enabled) {
    clearSettingsSubscription();
    hasCompletedInitialSync = false;
    useSettingsSyncStore.getState().actions.clearSyncState();
    return;
  }

  ensureSettingsSubscription();
  if (!hasCompletedInitialSync) {
    try {
      await runInitialSettingsSync();
      hasCompletedInitialSync = true;
    } catch (error) {
      handleSettingsSyncError(error, { disable: isAuthInvalidError(error) });
    }
  }
}
