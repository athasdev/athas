#!/usr/bin/env python3
"""Builds `assets/extensions/` from the Athas checkout next to this repository.

- `catalog.json`: every official extension manifest (`extensions/official/*/extension.json`),
  with the package each one installs from (`extensions/artifacts.json`) and the folder it has on
  the extensions CDN (`extensions/generated/cdn/manifests.json`). Icon themes keep their names
  only; their tables arrive with the installed package.
- `icons/<id>.svg`: each extension's icon, and whether it is drawn in `currentColor`.
- `pierre/`: the built-in Pierre icon themes, with their icons pointed at the embedded assets.

Run `python3 scripts/generate_extensions_catalog.py` after the official extensions change.
"""

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ATHAS = ROOT.parent / "athas"
OFFICIAL = ATHAS / "extensions" / "official"
ARTIFACTS = ATHAS / "extensions" / "artifacts.json"
CDN_MANIFESTS = ATHAS / "extensions" / "generated" / "cdn" / "manifests.json"
PIERRE = ATHAS / "src" / "extensions" / "bundled" / "icon-themes" / "pierre"
OUT = ROOT / "assets" / "extensions"
FILE_ICONS = ROOT / "assets" / "file-icons"

ICON_THEME_TABLES = (
    "iconDefinitions",
    "lightIconDefinitions",
    "fileExtensions",
    "filenames",
    "folders",
    "expandedFolders",
)
HEX_COLOR = re.compile(r"#([0-9a-fA-F]{3,8})\b")
BLACK = {"000", "000000", "000f", "000000ff"}


def is_monochrome(svg: str) -> bool:
    """Drawn in one ink: tinted with the text colour instead of shown as it is."""
    if "currentColor" in svg:
        return True
    colors = {match.lower() for match in HEX_COLOR.findall(svg)}
    return not (colors - BLACK)


def cdn_paths() -> dict:
    if not CDN_MANIFESTS.exists():
        return {}
    manifests = json.loads(CDN_MANIFESTS.read_text())
    return {manifest["id"]: path for path, manifest in manifests.items()}


def build_catalog() -> int:
    installations = json.loads(ARTIFACTS.read_text())["installations"]
    paths = cdn_paths()
    icons_dir = OUT / "icons"
    if icons_dir.exists():
        shutil.rmtree(icons_dir)
    icons_dir.mkdir(parents=True)

    entries = []
    for manifest_path in sorted(OFFICIAL.glob("*/extension.json")):
        folder = manifest_path.parent
        manifest = json.loads(manifest_path.read_text())
        extension_id = manifest["id"]
        if extension_id in installations:
            manifest["installation"] = installations[extension_id]
        for theme in manifest.get("icons", []):
            for table in ICON_THEME_TABLES:
                theme.pop(table, None)

        entry = {"path": paths.get(extension_id, folder.name), "manifest": manifest}
        icon = folder / "icon.svg"
        if icon.exists():
            svg = icon.read_text()
            shutil.copyfile(icon, icons_dir / f"{extension_id}.svg")
            entry["icon"] = f"extensions/icons/{extension_id}.svg"
            entry["monochromeIcon"] = is_monochrome(svg)
        entries.append(entry)

    entries.sort(key=lambda entry: entry["path"])
    catalog = {"version": 1, "extensions": entries}
    (OUT / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + "\n")
    return len(entries)


def build_pierre() -> None:
    """The file tree already embeds the Complete icons; the rest are copied next to the themes."""
    out = OUT / "pierre"
    if out.exists():
        shutil.rmtree(out)
    (out / "icons").mkdir(parents=True)
    manifest = json.loads((PIERRE / "extension.json").read_text())
    manifest.pop("bundled", None)

    def embedded(definition: str) -> str:
        name = definition.removeprefix("./icons/")
        if (FILE_ICONS / name).exists():
            return f"file-icons/{name}"
        shutil.copyfile(PIERRE / "icons" / name, out / "icons" / name)
        return f"extensions/pierre/icons/{name}"

    for theme in manifest["icons"]:
        for table in ("iconDefinitions", "lightIconDefinitions"):
            if table in theme:
                theme[table] = {key: embedded(value) for key, value in theme[table].items()}
    (out / "extension.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    if (PIERRE / "LICENSE").exists():
        shutil.copyfile(PIERRE / "LICENSE", out / "LICENSE")


if __name__ == "__main__":
    count = build_catalog()
    build_pierre()
    print(f"Wrote {count} extensions to {OUT.relative_to(ROOT)}")
