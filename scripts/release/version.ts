export type ReleaseChannel = "preview";
export type ReleaseBump = "patch" | "minor" | "major";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: {
    channel: ReleaseChannel;
    number: number;
  };
}

export function parseVersion(version: string): ParsedVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(preview)\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }

  return {
    major: Number.parseInt(match[1]),
    minor: Number.parseInt(match[2]),
    patch: Number.parseInt(match[3]),
    prerelease:
      match[4] && match[5]
        ? {
            channel: match[4] as ReleaseChannel,
            number: Number.parseInt(match[5]),
          }
        : undefined,
  };
}

export function parseStableVersion(version: string): ParsedVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1]),
    minor: Number.parseInt(match[2]),
    patch: Number.parseInt(match[3]),
  };
}

export function parsePrerelease(
  version: string,
): { channel: ReleaseChannel; number: number } | null {
  const match = version.match(/-(preview)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    channel: match[1] as ReleaseChannel,
    number: Number.parseInt(match[2]),
  };
}

export function formatVersion(version: ParsedVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  if (!version.prerelease) {
    return base;
  }

  return `${base}-${version.prerelease.channel}.${version.prerelease.number}`;
}

export function getReleaseCommitMessage(version: ParsedVersion): string {
  return version.prerelease ? "Prepare preview release" : "Prepare release";
}

export function getStableBase(version: ParsedVersion): ParsedVersion {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch,
  };
}

export function bumpStableBase(version: ParsedVersion, bump: ReleaseBump): ParsedVersion {
  const stable = getStableBase(version);

  switch (bump) {
    case "major":
      return { major: stable.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: stable.major, minor: stable.minor + 1, patch: 0 };
    case "patch":
      return version.prerelease ? stable : { ...stable, patch: stable.patch + 1 };
  }
}

export function sameStableBase(left: ParsedVersion, right: ParsedVersion): boolean {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch;
}
