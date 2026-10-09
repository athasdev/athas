import { versionFromTag } from "../assets/policy.mjs";

export const WINGET_PACKAGE_ID = "athasdev.Athas";
const WINGET_MANIFEST_VERSION = "1.10.0";
const DESCRIPTION =
  "A lightweight, cross-platform code editor built with Tauri, with Git support, AI agents and vim keybindings.";

const windowsInstallers = [
  { winget: "x64", scoop: "64bit", file: (version) => `Athas_${version}_x64-setup.exe` },
  { winget: "arm64", scoop: "arm64", file: (version) => `Athas_${version}_arm64-setup.exe` },
];

export function parseChecksums(text) {
  const checksums = new Map();
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

function checksumFor(checksums, name) {
  const checksum = checksums.get(name);
  if (!checksum) {
    throw new Error(`SHA256SUMS.txt has no entry for ${name}`);
  }
  return checksum;
}

function downloadUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

function wingetHeader(type) {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${WINGET_MANIFEST_VERSION}.schema.json\n`;
}

export function renderWingetManifests({ tag, repo, checksums, releaseDate }) {
  const version = versionFromTag(tag);
  const versionManifest = `${wingetHeader("version")}PackageIdentifier: ${WINGET_PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;

  const installers = windowsInstallers
    .map((installer) => {
      const name = installer.file(version);
      return `- Architecture: ${installer.winget}
  InstallerUrl: ${downloadUrl(repo, tag, name)}
  InstallerSha256: ${checksumFor(checksums, name).toUpperCase()}`;
    })
    .join("\n");

  const installerManifest = `${wingetHeader("installer")}PackageIdentifier: ${WINGET_PACKAGE_ID}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
ProductCode: Athas
ReleaseDate: ${releaseDate}
Installers:
${installers}
ManifestType: installer
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;

  const localeManifest = `${wingetHeader("defaultLocale")}PackageIdentifier: ${WINGET_PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Athas
PublisherUrl: https://athas.dev
PublisherSupportUrl: https://github.com/${repo}/issues
PackageName: Athas
PackageUrl: https://athas.dev
License: AGPL-3.0
LicenseUrl: https://github.com/${repo}/blob/main/LICENSE
ShortDescription: ${DESCRIPTION}
Moniker: athas
Tags:
- code-editor
- editor
- ide
- ai
- git
- vim
ReleaseNotesUrl: https://github.com/${repo}/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;

  return {
    [`${WINGET_PACKAGE_ID}.yaml`]: versionManifest,
    [`${WINGET_PACKAGE_ID}.installer.yaml`]: installerManifest,
    [`${WINGET_PACKAGE_ID}.locale.en-US.yaml`]: localeManifest,
  };
}

export function renderScoopManifest({ tag, repo, checksums }) {
  const version = versionFromTag(tag);
  const architecture = {};
  const autoupdate = {};
  for (const installer of windowsInstallers) {
    const name = installer.file(version);
    architecture[installer.scoop] = {
      url: `${downloadUrl(repo, tag, name)}#/dl.7z`,
      hash: checksumFor(checksums, name),
    };
    autoupdate[installer.scoop] = {
      url: `${downloadUrl(repo, "v$version", installer.file("$version"))}#/dl.7z`,
    };
  }

  const manifest = {
    version,
    description: DESCRIPTION,
    homepage: "https://athas.dev",
    license: "AGPL-3.0-only",
    architecture,
    pre_install: [
      'Remove-Item "$dir\\`$*", "$dir\\uninst*" -Force -Recurse',
      'Set-Content -LiteralPath "$dir\\managed-by-package-manager" -Value "scoop" -Encoding ASCII',
    ],
    shortcuts: [["athas.exe", "Athas"]],
    checkver: "github",
    autoupdate: {
      architecture: autoupdate,
      hash: {
        url: `https://github.com/${repo}/releases/download/v$version/SHA256SUMS.txt`,
      },
    },
  };

  return { "athas.json": `${JSON.stringify(manifest, null, 4)}\n` };
}
