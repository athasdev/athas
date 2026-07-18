import { getServiceUrls } from "@/config/services";

export interface WhatsNewInfo {
  version: string;
  previousVersion?: string;
  body?: string;
  date?: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface UpdateManifestResponse {
  version?: unknown;
  notes?: unknown;
  pub_date?: unknown;
}

interface GitHubReleaseResponse {
  body?: unknown;
  published_at?: unknown;
}

interface WhatsNewStorageState {
  current?: WhatsNewInfo;
  pending?: WhatsNewInfo;
}

const STORAGE_KEY = "athas-whats-new";

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function normalizeReleaseNotes(body: string): string {
  return body
    .trim()
    .split("\n")
    .map((line) => {
      const releaseEntry = line.match(
        /^\s*[*-]\s+(.+?)\s+by\s+(.+?)\s+in\s+(https:\/\/github\.com\/[^\s]+\/(?:pull\/\d+|commit\/[0-9a-f]+))\s*$/i,
      );
      if (releaseEntry) {
        const [, title, author, url] = releaseEntry;
        return `- [${escapeMarkdownLinkLabel(title)}](${url}) — ${author}`;
      }

      const fullChangelog = line.match(/^\s*\*\*Full Changelog\*\*:\s+(https?:\/\/\S+)\s*$/i);
      if (fullChangelog) {
        return `**Full changelog:** [Compare changes](${fullChangelog[1]})`;
      }

      return line;
    })
    .join("\n");
}

function formatReleaseDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function buildWhatsNewMarkdown(info: WhatsNewInfo): string {
  const services = getServiceUrls();
  const lines = ["---", "title: What's New in Athas", `description: Version ${info.version}`];

  if (info.previousVersion) {
    lines.push(`updated-from: ${info.previousVersion}`);
  }

  if (info.date) {
    lines.push(`released: ${formatReleaseDate(info.date)}`);
  }

  lines.push("---", "");

  if (info.body?.trim()) {
    const releaseNotes = normalizeReleaseNotes(info.body);
    if (!/^#{1,6}\s/m.test(releaseNotes)) {
      lines.push("## Changes", "");
    }
    lines.push(releaseNotes, "");
  } else {
    lines.push("## Release notes", "");
    lines.push("Release notes were not bundled with this update.", "");
    lines.push(
      "You can still review the GitHub release page for downloads and changelog notes.",
      "",
    );
  }

  lines.push("---");
  lines.push(
    `[View the full release on GitHub](${services.githubReleasesBaseUrl}/tag/v${info.version})`,
  );

  return lines.join("\n");
}

function releaseTag(version: string): string {
  return `v${version}`;
}

function updateChannel(version: string): "stable" | "preview" {
  return version.includes("-preview.") ? "preview" : "stable";
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.slice(0, 10);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchManifestInfo(info: WhatsNewInfo, fetchImpl: FetchLike): Promise<WhatsNewInfo> {
  const services = getServiceUrls();
  const updateUrl =
    updateChannel(info.version) === "preview"
      ? services.previewUpdateUrl
      : services.stableUpdateUrl;
  const response = await fetchImpl(updateUrl, {
    cache: "no-store",
  });
  const manifest = (await readJson(response)) as UpdateManifestResponse | null;

  if (manifest?.version !== info.version) {
    return info;
  }

  return {
    ...info,
    body: info.body || readText(manifest.notes),
    date: info.date || normalizeDate(readText(manifest.pub_date)),
  };
}

async function fetchGitHubReleaseInfo(
  info: WhatsNewInfo,
  fetchImpl: FetchLike,
): Promise<WhatsNewInfo> {
  const services = getServiceUrls();
  const response = await fetchImpl(
    `${services.githubReleasesApiBaseUrl}/tags/${releaseTag(info.version)}`,
    { cache: "no-store" },
  );
  const release = (await readJson(response)) as GitHubReleaseResponse | null;

  return {
    ...info,
    body: info.body || readText(release?.body),
    date: info.date || normalizeDate(readText(release?.published_at)),
  };
}

export async function resolveWhatsNewInfo(
  info: WhatsNewInfo,
  fetchImpl: FetchLike = fetch,
): Promise<WhatsNewInfo> {
  if (info.body?.trim()) {
    return info;
  }

  try {
    const manifestInfo = await fetchManifestInfo(info, fetchImpl);
    if (manifestInfo.body?.trim()) {
      return manifestInfo;
    }
  } catch {
    // Keep the local fallback available when release metadata cannot be fetched.
  }

  try {
    return await fetchGitHubReleaseInfo(info, fetchImpl);
  } catch {
    return info;
  }
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

export function storeCurrentWhatsNew(info: WhatsNewInfo) {
  const state = readState();
  writeState({
    ...state,
    current: info,
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
