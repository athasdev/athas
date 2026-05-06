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

export function buildWhatsNewMarkdown(info: WhatsNewInfo): string {
  const lines = [`# What's New in Athas ${info.version}`, ""];

  if (info.previousVersion) {
    lines.push(`Updated from \`${info.previousVersion}\`.`, "");
  }

  if (info.date) {
    lines.push(`Released: ${info.date}`, "");
  }

  if (info.body?.trim()) {
    lines.push(info.body.trim(), "");
  } else {
    lines.push("Release notes were not bundled with this update.", "");
    lines.push(
      "You can still review the GitHub release page for downloads and changelog notes.",
      "",
    );
  }

  lines.push("---");
  lines.push(
    `[View release on GitHub](https://github.com/athasdev/athas/releases/tag/v${info.version})`,
  );

  return lines.join("\n");
}

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
