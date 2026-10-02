export function versionFromTag(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return tag.slice(1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizedArtifactName(file, name) {
  if (name !== "Athas.app.tar.gz" && name !== "Athas.app.tar.gz.sig") {
    return name;
  }

  if (file.includes("/aarch64-apple-darwin/")) {
    return name.replace("Athas.app.tar.gz", "Athas_aarch64.app.tar.gz");
  }
  if (file.includes("/x86_64-apple-darwin/")) {
    return name.replace("Athas.app.tar.gz", "Athas_x64.app.tar.gz");
  }

  return name;
}

export function requiredAssets(version) {
  const escapedVersion = escapeRegExp(version);
  const appPrefix = "Athas";
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
      id: "linux-x64-appimage",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_amd64\\.AppImage$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-arm64-appimage",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_aarch64\\.AppImage$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-x64-flatpak",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_linux-x86_64\\.flatpak$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-arm64-flatpak",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_linux-aarch64\\.flatpak$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-x64-deb",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_amd64\\.deb$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-arm64-deb",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_arm64\\.deb$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-x64-rpm",
      pattern: new RegExp(`^${appPrefix}-${escapedVersion}-1\\.x86_64\\.rpm$`),
      signature: true,
      checksum: true,
    },
    {
      id: "linux-arm64-rpm",
      pattern: new RegExp(`^${appPrefix}-${escapedVersion}-1\\.aarch64\\.rpm$`),
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
    {
      id: "windows-x64-msi",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_x64_en-US\\.msi$`),
      signature: true,
      checksum: true,
    },
    {
      id: "windows-arm64-msi",
      pattern: new RegExp(`^${appPrefix}_${escapedVersion}_arm64_en-US\\.msi$`),
      signature: true,
      checksum: true,
    },
  ];
}

export function forbiddenAssetPatterns(version) {
  const escapedVersion = escapeRegExp(version);
  const appPrefix = "Athas";
  return [
    new RegExp(`^${appPrefix}_${escapedVersion}_(?:x64|arm64)-setup-machine\\.exe(?:\\.sig)?$`),
  ];
}
