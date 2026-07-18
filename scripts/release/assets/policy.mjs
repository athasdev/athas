export function versionFromTag(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return tag.slice(1);
}

export function channelFromTag(tag) {
  return tag.includes("-preview.") ? "preview" : "stable";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function displayAppPrefix(channel) {
  return channel === "preview" ? "Athas Preview" : "Athas";
}

export function releaseAssetPrefix(channel) {
  return channel === "preview" ? "Athas.Preview" : "Athas";
}

export function normalizeReleaseAssetName(name, channel) {
  if (channel !== "preview") {
    return name;
  }

  return name.startsWith("Athas Preview")
    ? name.replace("Athas Preview", releaseAssetPrefix(channel))
    : name;
}

export function normalizedArtifactName(file, name, channel) {
  const releasePrefix = releaseAssetPrefix(channel);
  const macUpdaterNames = [
    `${displayAppPrefix(channel)}.app.tar.gz`,
    `${releasePrefix}.app.tar.gz`,
  ];

  for (const macUpdaterName of macUpdaterNames) {
    if (name !== macUpdaterName && name !== `${macUpdaterName}.sig`) {
      continue;
    }

    if (file.includes("/aarch64-apple-darwin/")) {
      return name.replace(macUpdaterName, `${releasePrefix}_aarch64.app.tar.gz`);
    }
    if (file.includes("/x86_64-apple-darwin/")) {
      return name.replace(macUpdaterName, `${releasePrefix}_x64.app.tar.gz`);
    }
  }

  return normalizeReleaseAssetName(name, channel);
}

export function requiredAssets(version, channel) {
  const escapedVersion = escapeRegExp(version);
  const appPrefix = escapeRegExp(releaseAssetPrefix(channel));
  return [
    {
      id: "macos-arm64-dmg",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_aarch64\\.dmg$`),
      checksum: true,
    },
    {
      id: "macos-x64-dmg",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_x64\\.dmg$`),
      checksum: true,
    },
    {
      id: "macos-arm64-updater",
      pattern: new RegExp(`^${appPrefix}_aarch64\\.app\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "macos-x64-updater",
      pattern: new RegExp(`^${appPrefix}_x64\\.app\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-x64-tarball",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_linux-x86_64\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-arm64-tarball",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_linux-aarch64\\.tar\\.gz$`),
      signature: true,
      checksum: true,
    },
    {
      id: "windows-x64-nsis",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_x64-setup\\.exe$`),
      signature: true,
      checksum: true,
    },
    {
      id: "windows-arm64-nsis",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_arm64-setup\\.exe$`),
      signature: true,
      checksum: true,
    },
  ];
}

export function forbiddenAssetPatterns(version) {
  const escapedVersion = escapeRegExp(version);
  const appPrefix = "Athas(?:[ .]Preview)?";
  return [
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:x64|arm64)_en-US\\.msi(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:amd64|aarch64)\\.AppImage(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:amd64|arm64)\\.deb(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}-${escapedVersion}-1\\.(?:x86_64|aarch64)\\.rpm(?:\\.sig)?$`),
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:x64|arm64)-setup-machine\\.exe(?:\\.sig)?$`),
  ];
}
