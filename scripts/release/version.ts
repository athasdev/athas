export type ReleaseBump = "patch" | "minor" | "major";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const WINDOWS_MSI_PATCH_MULTIPLIER = 1000;
// Kept from the retired preview channel so MSI versions keep increasing over installed builds.
const WINDOWS_MSI_STABLE_OFFSET = 900;

export function parseVersion(version: string): ParsedVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }

  return {
    major: Number.parseInt(match[1]),
    minor: Number.parseInt(match[2]),
    patch: Number.parseInt(match[3]),
  };
}

export function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function getWindowsMsiVersion(version: ParsedVersion): string {
  if (version.major > 255 || version.minor > 255) {
    throw new Error("Windows MSI versions support major and minor values up to 255");
  }

  if (version.patch > 64) {
    throw new Error("Windows MSI version mapping supports patch versions up to 64");
  }

  const build = version.patch * WINDOWS_MSI_PATCH_MULTIPLIER + WINDOWS_MSI_STABLE_OFFSET;
  return `${version.major}.${version.minor}.${build}`;
}

export function bumpVersion(version: ParsedVersion, bump: ReleaseBump): ParsedVersion {
  switch (bump) {
    case "major":
      return { major: version.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case "patch":
      return { ...version, patch: version.patch + 1 };
  }
}
