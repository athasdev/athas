#!/usr/bin/env python3
"""Publishes official extensions to the extension registry the website serves.

The registry is the folder `EXTENSIONS_REGISTRY_DIR` points at (`/srv/athas/extensions` in
production, `../extensions` next to the `www` checkout in development). `athas.dev/extensions`
serves its `manifests.json`, which the app reads over its bundled catalog, its `index.json`,
which the website's extensions page lists, and the folder of each extension, which is where an
icon comes from when the app has none of its own.

    python3 scripts/build_extension_registry.py --out ../extensions gruvbox-theme rose-pine-theme
    python3 scripts/build_extension_registry.py --out /srv/athas/extensions --all

Extensions ported from other projects (the themes) are published this way instead of being
built into the app, so the binary carries nothing but Athas's own work. Entries already in the
registry are kept; only the extensions named on the command line are written.
"""

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OFFICIAL = ROOT / "extensions" / "official"

# The folder each extension has in the registry, which `manifests.json` keys it by. A theme
# lives under `theme/<name>`, as `athas.theme.vercel` already does.
PREFIXES = {"Theme": "theme", "Icons": "icon-theme", "Language": "language"}


def registry_path(manifest: dict, folder: Path) -> str:
    for category in manifest.get("categories", []):
        if category in PREFIXES:
            return f"{PREFIXES[category]}/{manifest['name']}"
    return folder.name


CDN_BASE_URL = "https://athas.dev/extensions"


def index_entry(manifest: dict, path: str, has_icon: bool) -> dict:
    """What the website lists (`mapRegistryEntry`): the manifest, flattened."""
    entry = {
        "id": manifest["id"],
        "displayName": manifest.get("displayName", manifest["name"]),
        "description": manifest.get("description", ""),
        "version": manifest["version"],
        "category": (manifest.get("categories") or ["Integration"])[0].lower(),
    }
    if has_icon:
        entry["icon"] = f"{CDN_BASE_URL}/{path}/icon.svg"
    return entry


def publish(folder: Path, out: Path, manifests: dict, index: list) -> str:
    manifest = json.loads((folder / "extension.json").read_text())
    path = registry_path(manifest, folder)
    manifests[path] = manifest
    icon = folder / "icon.svg"
    if icon.exists():
        (out / path).mkdir(parents=True, exist_ok=True)
        shutil.copyfile(icon, out / path / "icon.svg")
    entry = index_entry(manifest, path, icon.exists())
    for position, listed in enumerate(index):
        if listed.get("id") == entry["id"]:
            index[position] = entry
            break
    else:
        index.append(entry)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, help="the registry folder to write into")
    parser.add_argument("--all", action="store_true", help="publish every official extension")
    parser.add_argument("folders", nargs="*", help="the folders under extensions/official to publish")
    args = parser.parse_args()

    out = Path(args.out).expanduser().resolve()
    folders = sorted(OFFICIAL.iterdir()) if args.all else [OFFICIAL / name for name in args.folders]
    if not folders:
        parser.error("name at least one folder under extensions/official, or pass --all")
    missing = [folder for folder in folders if not (folder / "extension.json").exists()]
    if missing:
        parser.error(f"no extension.json in {', '.join(folder.name for folder in missing)}")

    out.mkdir(parents=True, exist_ok=True)
    manifests_file, index_file = out / "manifests.json", out / "index.json"
    manifests = json.loads(manifests_file.read_text()) if manifests_file.exists() else {}
    index = json.loads(index_file.read_text()) if index_file.exists() else []
    if not isinstance(index, list):
        parser.error(f"{index_file} is not a list of extensions")
    published = [publish(folder, out, manifests, index) for folder in folders]
    manifests_file.write_text(json.dumps(dict(sorted(manifests.items())), indent=1, ensure_ascii=False) + "\n")
    index.sort(key=lambda entry: entry.get("id", ""))
    index_file.write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    print(f"Published {len(published)} extensions to {out}: {', '.join(published)}")
    print(f"manifests.json now lists {len(manifests)}, index.json {len(index)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
