export type StableReleaseBump = "patch" | "minor" | "major";
export type ReleaseBump = StableReleaseBump | "beta";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  beta?: number;
}

const WINDOWS_MSI_PATCH_MULTIPLIER = 1000;
// Kept from the retired preview channel so MSI versions keep increasing over installed builds.
const WINDOWS_MSI_STABLE_OFFSET = 900;

export function parseVersion(version: string): ParsedVersion {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.([1-9]\d*))?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }

  const parsed: ParsedVersion = {
    major: Number.parseInt(match[1]),
    minor: Number.parseInt(match[2]),
    patch: Number.parseInt(match[3]),
  };
  if (match[4]) {
    parsed.beta = Number.parseInt(match[4]);
  }
  return parsed;
}

export function formatVersion(version: ParsedVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.beta ? `${base}-beta.${version.beta}` : base;
}

// MSI versions are numeric only. A beta of x.y.z maps below the stable x.y.z build and above
// every build of the previous patch, so beta and stable installs upgrade in order.
export function getWindowsMsiVersion(version: ParsedVersion): string {
  if (version.major > 255 || version.minor > 255) {
    throw new Error("Windows MSI versions support major and minor values up to 255");
  }

  if (version.patch > 64) {
    throw new Error("Windows MSI version mapping supports patch versions up to 64");
  }

  if (version.beta && version.beta >= WINDOWS_MSI_STABLE_OFFSET) {
    throw new Error(
      `Windows MSI version mapping supports beta numbers below ${WINDOWS_MSI_STABLE_OFFSET}`,
    );
  }

  const build =
    version.patch * WINDOWS_MSI_PATCH_MULTIPLIER + (version.beta ?? WINDOWS_MSI_STABLE_OFFSET);
  return `${version.major}.${version.minor}.${build}`;
}

function bumpStableVersion(version: ParsedVersion, bump: StableReleaseBump): ParsedVersion {
  const { major, minor, patch, beta } = version;
  // A stable bump from a beta releases the version the beta was leading up to.
  switch (bump) {
    case "major":
      return beta && minor === 0 && patch === 0
        ? { major, minor, patch }
        : { major: major + 1, minor: 0, patch: 0 };
    case "minor":
      return beta && patch === 0 ? { major, minor, patch } : { major, minor: minor + 1, patch: 0 };
    case "patch":
      return beta ? { major, minor, patch } : { major, minor, patch: patch + 1 };
  }
}

export function bumpVersion(
  version: ParsedVersion,
  bump: ReleaseBump,
  betaBase: StableReleaseBump = "patch",
): ParsedVersion {
  if (bump !== "beta") {
    return bumpStableVersion(version, bump);
  }

  if (version.beta) {
    return { ...version, beta: version.beta + 1 };
  }

  return { ...bumpStableVersion(version, betaBase), beta: 1 };
}
