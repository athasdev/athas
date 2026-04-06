export interface WhatsNewInfo {
  version: string;
  previousVersion?: string;
  body?: string;
  date?: string;
}

interface WhatsNewStorageState {
  current?: WhatsNewInfo;
  pending?: WhatsNewInfo;
}

const STORAGE_KEY = "athas-whats-new";

function readState(): WhatsNewStorageState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as WhatsNewStorageState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state: WhatsNewStorageState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function queuePendingWhatsNew(info: WhatsNewInfo) {
  const state = readState();
  writeState({
    ...state,
    pending: info,
  });
}

export function hydrateWhatsNew(currentVersion: string): {
  info: WhatsNewInfo;
  shouldAutoOpen: boolean;
} {
  const state = readState();

  if (state.pending?.version === currentVersion) {
    const info = state.pending;
    writeState({
      current: info,
    });

    return {
      info,
      shouldAutoOpen: true,
    };
  }

  if (state.current?.version === currentVersion) {
    return {
      info: state.current,
      shouldAutoOpen: false,
    };
  }

  const info = { version: currentVersion };
  writeState({
    ...state,
    current: info,
  });

  return {
    info,
    shouldAutoOpen: false,
  };
}
